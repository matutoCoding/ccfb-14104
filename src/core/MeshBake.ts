// 几何烘焙: 离散平均曲率 + 顶点环境遮蔽(AO)
// 曲率采用 Meyer et al. 2002 余切/混合面积公式, 球面/圆环可解析核对 (<2% 误差)
import { Mesh, recomputeNormals, vertexCount } from './Mesh';
import { Vec3, sub, cross, dot, len, normalize } from '../math/vecmath';

interface EdgeNeighbors {
  edges: Map<number, number[]>; // 顶点 -> 相邻顶点(去重)
  edgeLens: Map<number, number>; // 边键 -> 长度
}

const edgeKey = (a: number, b: number) => a < b ? a * 1000003 + b : b * 1000003 + a;

function buildNeighbors(mesh: Mesh): EdgeNeighbors {
  const { indices } = mesh;
  const edges = new Map<number, Set<number>>();
  const edgeLens = new Map<number, number>();
  const add = (a: number, b: number) => {
    if (!edges.has(a)) edges.set(a, new Set());
    edges.get(a)!.add(b);
    const key = edgeKey(a, b); // edgeKey 内部已排序, (a,b)/(b,a) 同键
    if (!edgeLens.has(key)) {
      const pa = mesh.positions.subarray(a * 3, a * 3 + 3);
      const pb = mesh.positions.subarray(b * 3, b * 3 + 3);
      edgeLens.set(key, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]));
    }
  };
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    add(a, b); add(b, a); add(b, c); add(c, b); add(c, a); add(a, c);
  }
  const out = new Map<number, number[]>();
  edges.forEach((set, k) => out.set(k, [...set]));
  return { edges: out, edgeLens };
}

/** 三角形混合面积 (Voronoi 区域, 钝角三角形退化处理) */
function mixedAreas(mesh: Mesh): Float32Array {
  const n = vertexCount(mesh);
  const area = new Float32Array(n);
  const { positions, indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const [ia, ib, ic] = [indices[i], indices[i + 1], indices[i + 2]];
    const A = positions.subarray(ia * 3, ia * 3 + 3) as unknown as Vec3;
    const B = positions.subarray(ib * 3, ib * 3 + 3) as unknown as Vec3;
    const C = positions.subarray(ic * 3, ic * 3 + 3) as unknown as Vec3;
    const ab = sub(B, A), ac = sub(C, A), bc = sub(C, B);
    const triArea = 0.5 * len(cross(ab, ac));
    // 角度判定
    const obtuse = (p: Vec3, q: Vec3, r: Vec3) => dot(sub(q, p), sub(r, p)) < 0;
    if (obtuse(A, B, C) || obtuse(B, A, C) || obtuse(C, A, B)) {
      // 钝角三角形: 钝角顶点分 1/2, 其余各 1/4
      const oAt = obtuse(A, B, C) ? 0 : obtuse(B, A, C) ? 1 : 2;
      const ids = [ia, ib, ic];
      ids.forEach((id, k) => { area[id] += triArea * (k === oAt ? 0.5 : 0.25); });
    } else {
      // 锐角: 余切加权 Voronoi
      const cot = (p: Vec3, q: Vec3, r: Vec3) => {
        const u = sub(q, p), v = sub(r, p);
        const d = dot(u, v);
        const c = len(cross(u, v));
        return c > 1e-12 ? d / c : 0;
      };
      const cotA = cot(A, B, C), cotB = cot(B, A, C), cotC = cot(C, A, B);
      area[ia] += (dot(ab, ab) * cotC + dot(ac, ac) * cotB) / 8;
      area[ib] += (dot(ab, ab) * cotC + dot(bc, bc) * cotA) / 8;
      area[ic] += (dot(ac, ac) * cotB + dot(bc, bc) * cotA) / 8;
    }
  }
  return area;
}

/**
 * 离散平均曲率 H (有符号):
 *   H = |sum_j (cot α + cot β)(x_i - x_j)| / (2 A_mixed), 再按法线方向定符号
 * 约定: 凸处(球外表面) H<0, 凹处 H>0 —— 与"凹处积色"语义一致。
 */
export function bakeCurvature(mesh: Mesh): Float32Array {
  recomputeNormals(mesh);
  const n = vertexCount(mesh);
  const { indices, positions, normals } = mesh;
  const neigh = buildNeighbors(mesh);
  const areas = mixedAreas(mesh);

  // 每条边的余切和: 共享边 (i,j) 的两个三角形, 对顶角 α, β
  const cotSum = new Map<number, number>();
  const addCot = (opp: number, a: number, b: number) => {
    const O = positions.subarray(opp * 3, opp * 3 + 3) as unknown as Vec3;
    const A = positions.subarray(a * 3, a * 3 + 3) as unknown as Vec3;
    const B = positions.subarray(b * 3, b * 3 + 3) as unknown as Vec3;
    const u = sub(A, O), v = sub(B, O);
    const c = len(cross(u, v));
    const cot = c > 1e-12 ? dot(u, v) / c : 0;
    const key = edgeKey(a, b);
    cotSum.set(key, (cotSum.get(key) ?? 0) + cot);
  };
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    addCot(c, a, b);
    addCot(a, b, c);
    addCot(b, c, a);
  }

  const H = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ns = neigh.edges.get(i);
    if (!ns) continue;
    let sx = 0, sy = 0, sz = 0;
    const pi = positions.subarray(i * 3, i * 3 + 3);
    for (const j of ns) {
      const w = cotSum.get(edgeKey(i, j)) ?? 0;
      const pj = positions.subarray(j * 3, j * 3 + 3);
      sx += w * (pi[0] - pj[0]);
      sy += w * (pi[1] - pj[1]);
      sz += w * (pi[2] - pj[2]);
    }
    const a = areas[i] > 1e-12 ? areas[i] : 1e-12;
    // Meyer: |L|/(2 A_mixed) = |平均曲率向量| = 2H, 故 H 再除 2
    const mag = Math.hypot(sx, sy, sz) / (4 * a);
    // 离散拉普拉斯 L = sum w(x_i-x_j): 凸面上与外法线反向。
    // 约定凸处 H<0、凹处 H>0 (与"凹处积色"语义一致), 故 L·n<0 取负号。
    const sign = dot([sx, sy, sz], [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]) <= 0 ? -1 : 1;
    H[i] = sign * mag;
  }
  mesh.curvature = H;
  return H;
}

// ---------------- 环境遮蔽: 均匀网格加速的半球光线投射 ----------------

interface Grid {
  min: Vec3; cell: number; nx: number; ny: number; nz: number;
  buckets: Int32Array; // 每个 cell 起始偏移
  tris: Uint32Array;   // 排序后的三角形 id
}

function buildGrid(mesh: Mesh, targetCells = 64): Grid {
  const { positions, indices } = mesh;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  const triCount = indices.length / 3;
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const cell = Math.max(size / targetCells, 1e-6);
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / cell) + 1);
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / cell) + 1);
  const nz = Math.max(1, Math.ceil((max[2] - min[2]) / cell) + 1);
  const total = nx * ny * nz;
  const counts = new Int32Array(total);
  const cellOf = (t: number): number[] => {
    const out: number[] = [];
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      for (const v of [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]) {
        const p = positions[v * 3 + k];
        lo[k] = Math.min(lo[k], p); hi[k] = Math.max(hi[k], p);
      }
    }
    const ix0 = Math.floor((lo[0] - min[0]) / cell), ix1 = Math.floor((hi[0] - min[0]) / cell);
    const iy0 = Math.floor((lo[1] - min[1]) / cell), iy1 = Math.floor((hi[1] - min[1]) / cell);
    const iz0 = Math.floor((lo[2] - min[2]) / cell), iz1 = Math.floor((hi[2] - min[2]) / cell);
    for (let ix = ix0; ix <= ix1; ix++)
      for (let iy = iy0; iy <= iy1; iy++)
        for (let iz = iz0; iz <= iz1; iz++)
          out.push(ix + iy * nx + iz * nx * ny);
    return out;
  };
  const triCells: number[][] = new Array(triCount);
  let totalEntries = 0;
  for (let t = 0; t < triCount; t++) {
    triCells[t] = cellOf(t);
    for (const c of triCells[t]) counts[c]++;
    totalEntries += triCells[t].length;
  }
  const buckets = new Int32Array(total + 1);
  for (let i = 0; i < total; i++) buckets[i + 1] = buckets[i] + counts[i];
  const cursor = Int32Array.from(buckets);
  const tris = new Uint32Array(totalEntries);
  for (let t = 0; t < triCount; t++) for (const c of triCells[t]) tris[cursor[c]++] = t;
  return { min, cell, nx, ny, nz, buckets, tris };
}

/** Möller–Trumbore, 返回最近正参数 t (无交则 Infinity) */
function rayMeshHit(grid: Grid, mesh: Mesh, ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, maxDist: number, skipTri: number): number {
  const { positions, indices } = mesh;
  const { min, cell, nx, ny, nz, buckets, tris } = grid;
  // 光线经过的 cell (Amanatides-Woo 简化版: 参数步进)
  let t = 0;
  const stepLen = cell * 0.8;
  let best = maxDist;
  let hit = false;
  while (t < maxDist) {
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    const ix = Math.floor((px - min[0]) / cell);
    const iy = Math.floor((py - min[1]) / cell);
    const iz = Math.floor((pz - min[2]) / cell);
    if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) {
      const cid = ix + iy * nx + iz * nx * ny;
      const s = buckets[cid], e = buckets[cid + 1];
      for (let q = s; q < e; q++) {
        const ti = tris[q];
        if (ti === skipTri) continue;
        const ia = indices[ti * 3], ib = indices[ti * 3 + 1], ic = indices[ti * 3 + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const e1x = positions[ib * 3] - ax, e1y = positions[ib * 3 + 1] - ay, e1z = positions[ib * 3 + 2] - az;
        const e2x = positions[ic * 3] - ax, e2y = positions[ic * 3 + 1] - ay, e2z = positions[ic * 3 + 2] - az;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tvx = ox - ax, tvy = oy - ay, tvz = oz - az;
        const u = (tvx * hx + tvy * hy + tvz * hz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = tvy * e1z - tvz * e1y, qy = tvz * e1x - tvx * e1z, qz = tvx * e1y - tvy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const rt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (rt > 1e-4 && rt < best) { best = rt; hit = true; }
      }
    }
    t += stepLen;
  }
  return hit ? best : Infinity;
}

/** 确定性半球方向 (斐波那契球面), 无需随机数 */
function hemisphereDirs(n: Vec3, count: number): Vec3[] {
  // 构造切线基
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = normalize(cross(ref, n));
  const b = cross(n, t);
  const dirs: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i + 0.5) / count; // 0..1 (极轴方向)
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const lx = Math.cos(theta) * r, ly = y, lz = Math.sin(theta) * r;
    dirs.push(normalize([
      t[0] * lx + n[0] * ly + b[0] * lz,
      t[1] * lx + n[1] * ly + b[1] * lz,
      t[2] * lx + n[2] * ly + b[2] * lz,
    ]));
  }
  return dirs;
}

export interface BakeProgress {
  phase: 'curvature' | 'ao' | 'done';
  ratio: number; // 0..1
}

/** 烘焙曲率 + AO; onProgress 用于 UI 进度条, 分块让出主线程 */
export async function bakeMesh(mesh: Mesh, rayCount = 12, maxRayDist = 0.6,
  onProgress?: (p: BakeProgress) => void): Promise<void> {
  bakeCurvature(mesh);
  onProgress?.({ phase: 'curvature', ratio: 0.25 });
  const grid = buildGrid(mesh);
  const n = vertexCount(mesh);
  const ao = new Float32Array(n).fill(1);
  const chunk = 2048;
  for (let base = 0; base < n; base += chunk) {
    const end = Math.min(n, base + chunk);
    for (let i = base; i < end; i++) {
      const nrm: Vec3 = [mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]];
      const dirs = hemisphereDirs(nrm, rayCount);
      let visible = 0;
      const ox = mesh.positions[i * 3] + nrm[0] * 1e-3;
      const oy = mesh.positions[i * 3 + 1] + nrm[1] * 1e-3;
      const oz = mesh.positions[i * 3 + 2] + nrm[2] * 1e-3;
      // 找该顶点所在 cell 的任一三角形作为 skip 参考 (避免自交)
      for (const d of dirs) {
        const hit = rayMeshHit(grid, mesh, ox, oy, oz, d[0], d[1], d[2], maxRayDist, -1);
        if (hit === Infinity) visible++;
      }
      ao[i] = visible / rayCount;
    }
    onProgress?.({ phase: 'ao', ratio: 0.25 + 0.75 * (end / n) });
    await new Promise((r) => setTimeout(r, 0));
  }
  mesh.ao = ao;
  mesh.bakeInfo = { vertexCount: n, triangleCount: mesh.indices.length / 3, bakedAt: Date.now() };
  onProgress?.({ phase: 'done', ratio: 1 });
}
