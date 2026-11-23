// 自动减面: Garland-Heckbert QEM 边坍缩 (稳健版)
// 二次误差矩阵 Q 选边; 每轮坍缩后增量维护顶点邻接表与边代价, 三角形存活标记
import { Mesh, recomputeNormals, vertexCount } from './Mesh';
import { Vec3, dot } from '../math/vecmath';

type Q = Float32Array; // 对称 4x4

function planeQuadric(p: Vec3, n: Vec3): Q {
  const [a, b, c] = n;
  const d = -dot(p, n);
  const v = [a, b, c, d];
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) m[i * 4 + j] = v[i] * v[j];
  return m;
}

function qAdd(a: Q, b: Q): Q {
  const out = new Float32Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[i] + b[i];
  return out;
}

function qEval(q: Q, x: number, y: number, z: number): number {
  const v = [x, y, z, 1];
  let s = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += v[i] * q[i * 4 + j] * v[j];
  return s;
}

/** 求使误差最小的坍缩点; 奇异时退化为端点/中点 */
function optimalPoint(q: Q, a: Vec3, b: Vec3): Vec3 {
  const m = [q[0], q[1], q[2], q[4], q[5], q[6], q[8], q[9], q[10]];
  const rhs = [-q[3], -q[7], -q[11]];
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(det) > 1e-12) {
    const x =
      (rhs[0] * (m[4] * m[8] - m[5] * m[7]) -
        m[1] * (rhs[1] * m[8] - m[5] * rhs[2]) +
        m[2] * (rhs[1] * m[7] - m[4] * rhs[2])) / det;
    const y =
      (m[0] * (rhs[1] * m[8] - m[5] * rhs[2]) -
        rhs[0] * (m[3] * m[8] - m[5] * m[6]) +
        m[2] * (m[3] * rhs[2] - rhs[1] * m[6])) / det;
    const z =
      (m[0] * (m[4] * rhs[2] - rhs[1] * m[7]) -
        m[1] * (m[3] * rhs[2] - rhs[1] * m[6]) +
        rhs[0] * (m[3] * m[7] - m[4] * m[6])) / det;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  }
  const ea = qEval(q, a[0], a[1], a[2]);
  const eb = qEval(q, b[0], b[1], b[2]);
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const em = qEval(q, mid[0], mid[1], mid[2]);
  return em <= ea && em <= eb ? mid : ea <= eb ? a : b;
}

class MinHeap {
  private items: { key: number; a: number; b: number; ver: number }[] = [];
  get size() { return this.items.length; }
  push(key: number, a: number, b: number, ver: number) {
    const it = { key, a, b, ver };
    this.items.push(it);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].key <= this.items[i].key) break;
      [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
      i = p;
    }
  }
  pop() {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < this.items.length && this.items[l].key < this.items[s].key) s = l;
        if (r < this.items.length && this.items[r].key < this.items[s].key) s = r;
        if (s === i) break;
        [this.items[s], this.items[i]] = [this.items[i], this.items[s]];
        i = s;
      }
    }
    return top;
  }
}

export interface DecimateProgress { ratio: number; removed: number; total: number; }

const ekey = (a: number, b: number) => (a < b ? a * 1000003 + b : b * 1000003 + a);

function triNormal(pos: Float32Array, ids: ArrayLike<number>): Vec3 {
  const ia = ids[0] * 3, ib = ids[1] * 3, ic = ids[2] * 3;
  const ux = pos[ib] - pos[ia], uy = pos[ib + 1] - pos[ia + 1], uz = pos[ib + 2] - pos[ia + 2];
  const vx = pos[ic] - pos[ia], vy = pos[ic + 1] - pos[ia + 1], vz = pos[ic + 2] - pos[ia + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * QEM 减面到目标面数。返回新 Mesh, 需重新烘焙法线/曲率/AO。
 * 采用"工作三角形数组 + 顶点邻接集合 + 边版本号", 坍缩后原地重映射索引。
 */
export function decimate(mesh: Mesh, targetTriangles: number,
  onProgress?: (p: DecimateProgress) => void): Mesh {
  const n0 = vertexCount(mesh);
  const { positions, normals, indices } = mesh;
  const currentTri = indices.length / 3;
  if (targetTriangles >= currentTri) return mesh;

  // 1. 每顶点 Q
  const quadrics: Q[] = new Array(n0);
  for (let i = 0; i < n0; i++) quadrics[i] = new Float32Array(16);
  for (let t = 0; t < indices.length; t += 3) {
    const [ia, ib, ic] = [indices[t], indices[t + 1], indices[t + 2]];
    const p: Vec3 = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const n: Vec3 = [normals[ia * 3], normals[ia * 3 + 1], normals[ia * 3 + 2]];
    const k = planeQuadric(p, n);
    for (const v of [ia, ib, ic]) for (let i = 0; i < 16; i++) quadrics[v][i] += k[i];
  }

  // 2. 工作副本: 三角形存为可变三元组, 顶点存活/坐标
  const aliveV = new Uint8Array(n0).fill(1);
  const pos = Float32Array.from(positions);
  // triVerts[t] = [a,b,c] (顶点 id, 坍缩时把 b 改写为 a)
  const triVerts: number[][] = [];
  // 顶点 -> 邻接三角形 / 邻接顶点
  const vTris: Set<number>[] = Array.from({ length: n0 }, () => new Set());
  const vNei: Set<number>[] = Array.from({ length: n0 }, () => new Set());
  for (let t = 0; t < currentTri; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    triVerts.push([a, b, c]);
    vTris[a].add(t); vTris[b].add(t); vTris[c].add(t);
    vNei[a].add(b); vNei[a].add(c);
    vNei[b].add(a); vNei[b].add(c);
    vNei[c].add(a); vNei[c].add(b);
  }

  // 3. 边代价 + 版本号
  const edgeVer = new Map<number, number>();
  const heap = new MinHeap();
  const edgeCost = (a: number, b: number) => {
    const q = qAdd(quadrics[a], quadrics[b]);
    const pa: Vec3 = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const pb: Vec3 = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const target = optimalPoint(q, pa, pb);
    return { cost: qEval(q, target[0], target[1], target[2]), target, q };
  };
  const pushEdge = (a: number, b: number) => {
    const key = ekey(a, b);
    const ver = (edgeVer.get(key) ?? 0) + 1;
    edgeVer.set(key, ver);
    const { cost } = edgeCost(a, b);
    heap.push(cost, a, b, ver);
  };
  for (let i = 0; i < n0; i++) for (const j of vNei[i]) if (i < j) pushEdge(i, j);

  let aliveTri = currentTri;
  const removals = currentTri - targetTriangles;
  let removed = 0;

  /**
   * 单趟坍缩。flipThreshold 为法线点积下限: 越宽松(-1)越敢坍硬表面。
   * 严格趟保形; 未达目标时用宽松趟兜底, 保证减到目标面数。
   */
  const runPass = (flipThreshold: number): void => {
    // 每趟开始: 用当前存活邻接关系重建堆 (被上一趟拦截的边重新获得机会)
    for (let i = 0; i < n0; i++) {
      if (!aliveV[i]) continue;
      for (const c of vNei[i]) if (i < c && aliveV[c]) pushEdge(i, c);
    }
    let guard = 0;
    const maxIter = n0 * 6;
    while (removed < removals && heap.size > 0 && guard++ < maxIter) {
      const top = heap.pop()!;
      const { a, b } = top;
      if (!aliveV[a] || !aliveV[b]) continue;
      const key = ekey(a, b);
      if (edgeVer.get(key) !== top.ver) continue;
      if (!vNei[a].has(b)) continue;

      const { target, q } = edgeCost(a, b);

      // 法线翻转保护
      let flip = false;
      const candidateTris = new Set<number>([...vTris[a], ...vTris[b]]);
      for (const t of candidateTris) {
        const ids = triVerts[t];
        if (ids.includes(b) && ids.includes(a)) continue;
        const mapped = ids.map((v) => (v === b ? a : v));
        if (mapped[0] === mapped[1] || mapped[1] === mapped[2] || mapped[2] === mapped[0]) continue;
        const oldN = triNormal(pos, ids);
        const tmp = new Float32Array(pos);
        tmp[a * 3] = target[0]; tmp[a * 3 + 1] = target[1]; tmp[a * 3 + 2] = target[2];
        const newN = triNormal(tmp, mapped);
        if (dot(oldN, newN) < flipThreshold) { flip = true; break; }
      }
      if (flip) continue;

      // ---- 执行坍缩 b -> a ----
      pos[a * 3] = target[0]; pos[a * 3 + 1] = target[1]; pos[a * 3 + 2] = target[2];
      quadrics[a] = q;
      aliveV[b] = 0;

      const deadTris: number[] = [];
      for (const t of [...vTris[b]]) {
        const ids = triVerts[t];
        if (ids.includes(a)) {
          deadTris.push(t);
        } else {
          for (let k = 0; k < 3; k++) if (ids[k] === b) ids[k] = a;
          vTris[a].add(t);
        }
      }
      for (const t of deadTris) {
        const ids = triVerts[t];
        vTris[ids[0]].delete(t); vTris[ids[1]].delete(t); vTris[ids[2]].delete(t);
        aliveTri--;
        removed++;
      }
      vTris[b].clear();

      const bNei = [...vNei[b]];
      for (const c of bNei) {
        if (c === a) continue;
        vNei[c].delete(b);
        if (!vNei[a].has(c)) {
          vNei[a].add(c);
          vNei[c].add(a);
        }
      }
      vNei[b].clear();
      vNei[a].delete(b);
      for (const c of vNei[a]) vNei[c].delete(b);

      for (const c of vNei[a]) pushEdge(a, c);

      if (removed % 2000 === 0) onProgress?.({ ratio: removed / removals, removed, total: removals });
      if (aliveTri <= targetTriangles) break;
    }
  };

  // 第一趟: 严格保形; 第二趟: 放宽翻转阈值兜底, 确保达到目标面数
  runPass(0.05);
  if (aliveTri > targetTriangles) runPass(-0.5);
  if (aliveTri > targetTriangles) runPass(-1.0);

  // 4. 压缩输出: 仅保留存活三角形, 重映射顶点
  const remap = new Int32Array(n0).fill(-1);
  const keep: number[] = [];
  for (let t = 0; t < currentTri; t++) {
    const ids = triVerts[t];
    const dead = ids.some((v) => !aliveV[v]) || new Set(ids).size < 3;
    if (dead) continue;
    for (const v of ids) {
      if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); }
    }
  }
  const outPos = new Float32Array(keep.length * 3);
  keep.forEach((src, dst) => outPos.set(pos.subarray(src * 3, src * 3 + 3), dst * 3));
  const outIdx: number[] = [];
  for (let t = 0; t < currentTri; t++) {
    const ids = triVerts[t];
    if (ids.some((v) => !aliveV[v]) || new Set(ids).size < 3) continue;
    outIdx.push(remap[ids[0]], remap[ids[1]], remap[ids[2]]);
  }
  const out: Mesh = {
    name: mesh.name,
    positions: outPos,
    normals: new Float32Array(outPos.length),
    indices: Uint32Array.from(outIdx),
    curvature: new Float32Array(keep.length),
    ao: new Float32Array(keep.length),
  };
  recomputeNormals(out);
  onProgress?.({ ratio: 1, removed, total: removals });
  return out;
}
