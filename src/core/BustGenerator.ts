// 程序化胸像生成: 头/颈/肩胸 + 衣褶(谐波布料) + 浮雕底座
// 全部参数化曲面拼接, 输出单一网格, 后续走统一烘焙管线
import { Mesh, recomputeNormals } from './Mesh';

class MeshBuilder {
  positions: number[] = [];
  indices: number[] = [];
  add(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) { this.indices.push(a, b, c); }
  get vertexCount() { return this.positions.length / 3; }
}

/** 超椭球: a,b,c 半轴, e1/e2 形状指数 (1=椭球, 越小越方) */
function superEllipsoid(b: MeshBuilder, cx: number, cy: number, cz: number,
  a: number, bb: number, c: number, e1: number, e2: number, segU: number, segV: number,
  deform?: (p: { x: number; y: number; z: number; u: number; v: number }) => void): void {
  const sp = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
  const base = b.vertexCount;
  const row = segU + 1;
  for (let j = 0; j <= segV; j++) {
    const eta = -Math.PI / 2 + (j / segV) * Math.PI; // 纬
    for (let i = 0; i <= segU; i++) {
      const omega = -Math.PI + (i / segU) * Math.PI * 2; // 经
      const ce = Math.cos(eta), se = Math.sin(eta);
      const co = Math.cos(omega), so = Math.sin(omega);
      let x = a * sp(ce, e1) * sp(co, e2);
      let y = bb * sp(se, e1);
      let z = c * sp(ce, e1) * sp(so, e2);
      x += cx; y += cy; z += cz;
      const p = { x, y, z, u: i / segU, v: j / segV };
      deform?.(p);
      b.add(p.x, p.y, p.z);
    }
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a0 = base + j * row + i, b0 = a0 + 1, c0 = a0 + row, d0 = c0 + 1;
      b.tri(a0, c0, b0);
      b.tri(b0, c0, d0);
    }
  }
}

/** 绕 Y 旋转曲面 (截面半径函数), 带可选角度/高度扰动用于衣褶 */
function lathe(b: MeshBuilder, radiusFn: (t: number, theta: number) => number,
  y0: number, y1: number, segU: number, segV: number): void {
  const base = b.vertexCount;
  const row = segU + 1;
  for (let j = 0; j <= segV; j++) {
    const t = j / segV;
    const y = y0 + (y1 - y0) * t;
    for (let i = 0; i <= segU; i++) {
      const theta = (i / segU) * Math.PI * 2;
      const r = radiusFn(t, theta);
      b.add(r * Math.cos(theta), y, r * Math.sin(theta));
    }
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a0 = base + j * row + i, b0 = a0 + 1, c0 = a0 + row, d0 = c0 + 1;
      b.tri(a0, b0, c0);
      b.tri(b0, d0, c0);
    }
  }
}

/** 圆柱/圆台 */
function frustum(b: MeshBuilder, rTop: number, rBottom: number, h: number, cy: number, segU: number): void {
  const base = b.vertexCount;
  const row = segU + 1;
  for (let j = 0; j <= 1; j++) {
    const r = j === 0 ? rBottom : rTop;
    const y = cy + (j === 0 ? -h / 2 : h / 2);
    for (let i = 0; i <= segU; i++) {
      const theta = (i / segU) * Math.PI * 2;
      b.add(r * Math.cos(theta), y, r * Math.sin(theta));
    }
  }
  for (let i = 0; i < segU; i++) {
    const a0 = base + i, b0 = a0 + 1, c0 = a0 + row, d0 = c0 + 1;
    b.tri(a0, b0, c0);
    b.tri(b0, d0, c0);
  }
  // 顶盖/底盖
  const topCenter = b.add(0, cy + h / 2, 0);
  const bottomCenter = b.add(0, cy - h / 2, 0);
  const topRow = base + row;
  for (let i = 0; i < segU; i++) {
    b.tri(topCenter, topRow + i, topRow + i + 1);
    b.tri(bottomCenter, base + i + 1, base + i);
  }
}

/** 底座侧面的浮雕环带: 凸起的卷草纹 (正弦波沿圆周传播) */
function reliefBand(b: MeshBuilder, radius: number, y0: number, y1: number, segU: number, segV: number): void {
  const base = b.vertexCount;
  const row = segU + 1;
  for (let j = 0; j <= segV; j++) {
    const t = j / segV;
    const y = y0 + (y1 - y0) * t;
    for (let i = 0; i <= segU; i++) {
      const theta = (i / segU) * Math.PI * 2;
      // 主纹: 8 组卷草, 次纹: 双倍频小波浪, 垂直方向高斯包络
      const envelope = Math.sin(Math.PI * t);
      const pattern = 0.5 + 0.5 * Math.sin(theta * 8 + Math.sin(theta * 3) * 1.5);
      const fine = 0.25 * Math.sin(theta * 16);
      const relief = envelope * (0.045 * pattern + 0.015 * fine);
      const r = radius + relief;
      b.add(r * Math.cos(theta), y, r * Math.sin(theta));
    }
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a0 = base + j * row + i, b0 = a0 + 1, c0 = a0 + row, d0 = c0 + 1;
      b.tri(a0, b0, c0);
      b.tri(b0, d0, c0);
    }
  }
}

export interface BustOptions {
  /** 衣褶褶数与深度 */
  foldCount?: number;
  foldDepth?: number;
  /** 网格密度 (每片曲面的经向分段) */
  resolution?: number;
}

/**
 * 生成带衣褶与浮雕底座的人物胸像, 高度约 3 单位, 居中于原点附近。
 */
export function generateBust(opts: BustOptions = {}): Mesh {
  const foldCount = opts.foldCount ?? 7;
  const foldDepth = opts.foldDepth ?? 0.09;
  const res = opts.resolution ?? 72;
  const b = new MeshBuilder();

  // ---- 底座: 三级圆台 + 浮雕环带 ----
  frustum(b, 0.62, 0.7, 0.16, -1.42, res);
  frustum(b, 0.55, 0.62, 0.14, -1.27, res);
  reliefBand(b, 0.55, -1.2, -1.02, res * 2, 12);
  frustum(b, 0.42, 0.55, 0.12, -0.96, res);

  // ---- 肩胸: 扁宽超椭球 (e 小 => 方肩), 顶部收向脖颈 ----
  superEllipsoid(b, 0, -0.55, 0, 0.78, 0.62, 0.46, 0.55, 0.6, res, Math.floor(res * 0.7), (p) => {
    // 胸像底部削平: 低于底座顶面的部分收窄
    if (p.y < -1.0) {
      const k = Math.max(0.4, 1 - (-1.0 - p.y) * 2.2);
      p.x *= k; p.z *= k;
    }
    // 锁骨区域轻微下压
    const neck = Math.exp(-(p.x * p.x) / 0.12) * Math.max(0, p.y + 0.2) * 0.12;
    p.y -= neck * 0.4;
  });

  // ---- 衣褶衣身: 旋转曲面, 半径随角度产生垂直垂坠褶皱 ----
  lathe(b, (t, theta) => {
    const baseR = 0.46 - 0.18 * t + 0.06 * Math.sin(Math.PI * t); // 向上收窄
    const foldPhase = theta * foldCount + 0.7 * Math.sin(t * 4); // 褶线随高度微摆
    const folds = foldDepth * Math.sin(foldPhase) * (0.4 + 0.6 * (1 - t)); // 下摆褶更深
    // 正面 (theta ≈ -PI/2, 即 -z 方向) 衣褶略强, 模拟胸前垂布
    const front = 0.7 + 0.3 * Math.max(0, -Math.sin(theta));
    return Math.max(0.05, baseR + folds * front);
  }, -1.0, 0.05, res, Math.floor(res * 0.8));

  // ---- 脖颈 ----
  superEllipsoid(b, 0, 0.18, 0, 0.2, 0.3, 0.2, 0.9, 0.9, res, Math.floor(res * 0.5));

  // ---- 头部: 超椭球近似头骨, 下颌收窄 ----
  superEllipsoid(b, 0, 0.62, 0, 0.27, 0.34, 0.25, 0.78, 0.85, res, res, (p) => {
    // 下颌: 下半部且靠下时前后收窄
    const jaw = Math.max(0, -(p.y - 0.55)) * 2.2;
    p.z *= 1 - jaw * 0.35;
    p.x *= 1 - jaw * 0.15;
    // 鼻部隆起 (正面 -z)
    const noseZ = -0.22;
    const dx = p.x, dy = (p.y - 0.66) * 1.4;
    const nose = Math.exp(-(dx * dx * 40 + dy * dy * 30));
    p.z -= nose * 0.07;
    // 眼眶凹陷 (左右对称), 凹处后续会积色
    const eye = Math.exp(-(((p.x - 0.1) ** 2 + (p.y - 0.7) ** 2) * 55))
      + Math.exp(-(((p.x + 0.1) ** 2 + (p.y - 0.7) ** 2) * 55));
    p.z += eye * 0.02;
  });

  // ---- 双耳 (小超椭球) ----
  superEllipsoid(b, 0.27, 0.62, 0, 0.045, 0.09, 0.06, 0.8, 0.8, 24, 18);
  superEllipsoid(b, -0.27, 0.62, 0, 0.045, 0.09, 0.06, 0.8, 0.8, 24, 18);

  // ---- 底座上沿装饰珠串 (一圈小凸起, 验证凸点擦亮) ----
  const beads = 24;
  for (let i = 0; i < beads; i++) {
    const theta = (i / beads) * Math.PI * 2;
    superEllipsoid(
      b, 0.56 * Math.cos(theta), -0.9, 0.56 * Math.sin(theta),
      0.028, 0.028, 0.028, 1, 1, 12, 8,
    );
  }

  const mesh: Mesh = {
    name: '程序化胸像',
    positions: Float32Array.from(b.positions),
    normals: new Float32Array(b.positions.length),
    indices: Uint32Array.from(b.indices),
    curvature: new Float32Array(b.positions.length / 3),
    ao: new Float32Array(b.positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}
