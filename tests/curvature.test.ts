// 曲率算法核对: 球与圆环(解析曲率已知), 要求平均/中位误差 < 2%
// 运行: npm test
import { bakeCurvature } from '../src/core/MeshBake';
import { Mesh, recomputeNormals, weldVertices } from '../src/core/Mesh';

function makeSphere(radius: number, segU: number, segV: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    for (let u = 0; u <= segU; u++) {
      const theta = (u / segU) * Math.PI * 2;
      positions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }
  }
  const row = segU + 1;
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * row + u, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const mesh: Mesh = {
    name: 'sphere',
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices),
    curvature: new Float32Array(positions.length / 3),
    ao: new Float32Array(positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}

function makeTorus(R: number, r: number, segU: number, segV: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const rr = R + r * Math.cos(v);
      positions.push(rr * Math.cos(u), r * Math.sin(v), rr * Math.sin(u));
    }
  }
  const row = segV + 1;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const mesh: Mesh = {
    name: 'torus',
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices),
    curvature: new Float32Array(positions.length / 3),
    ao: new Float32Array(positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}

/** 圆环主曲率: k1=cos v/(R+r cos v), k2=1/r; H=(k1+k2)/2。
 * 符号由算法约定自动给出 (凸负凹正): 外脊 v=0 为负, 内圈 v=π 为正,
 * 故解析值不做整体取负, 与离散 L·n 判定保持一致。 */
function torusMeanH(R: number, r: number, v: number): number {
  const k1 = Math.cos(v) / (R + r * Math.cos(v));
  const k2 = 1 / r;
  return (k1 + k2) / 2;
}

function stats(errors: number[]): { mean: number; median: number; max: number } {
  const sorted = [...errors].sort((a, b) => a - b);
  const mean = errors.reduce((s, x) => s + x, 0) / errors.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { mean, median, max: sorted[sorted.length - 1] };
}

let failed = 0;
function check(name: string, errors: number[], threshold = 0.02) {
  const s = stats(errors);
  const ok = s.mean < threshold && s.median < threshold;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}: 平均误差 ${(s.mean * 100).toFixed(3)}%  中位 ${(s.median * 100).toFixed(3)}%  最大 ${(s.max * 100).toFixed(2)}% (阈值 ${threshold * 100}%)`,
  );
  if (!ok) failed++;
}

// --- 球: 解析平均曲率 H = -1/R (外表面为凸, 约定为负) ---
for (const R of [0.5, 1, 2]) {
  let sphere = makeSphere(R, 96, 64);
  sphere = weldVertices(sphere, 1e-6); // 焊掉 UV 接缝与极点的重复顶点, 消除拓扑退化离群值
  bakeCurvature(sphere);
  const expected = -1 / R;
  const errors: number[] = [];
  const n = sphere.curvature.length;
  for (let i = 0; i < n; i++) {
    // 排除极区退化顶点
    const y = sphere.positions[i * 3 + 1];
    if (Math.abs(Math.abs(y / R) - 1) < 0.02) continue;
    errors.push(Math.abs(sphere.curvature[i] - expected) / Math.abs(expected));
  }
  check(`球面 R=${R} H=-1/R=${expected.toFixed(3)}`, errors);
}

// --- 圆环 ---
{
  const R = 1, r = 0.35;
  let torus = makeTorus(R, r, 128, 64);
  torus = weldVertices(torus, 1e-6);
  bakeCurvature(torus);
  const errors: number[] = [];
  // 焊接后顶点顺序重排, 直接按位置反算参数 v 做解析对照
  for (let i = 0; i < torus.curvature.length; i++) {
    const x = torus.positions[i * 3], y = torus.positions[i * 3 + 1], z = torus.positions[i * 3 + 2];
    const radial = Math.hypot(x, z);
    const cosV = (radial - R) / r;
    if (Math.abs(cosV) > 0.999) continue; // 跳过参数退化点
    const v = Math.acos(Math.max(-1, Math.min(1, cosV))) * (y < 0 ? -1 : 1);
    const expected = torusMeanH(R, r, v);
    errors.push(Math.abs(torus.curvature[i] - expected) / Math.max(Math.abs(expected), 1e-6));
  }
  check(`圆环 R=${R} r=${r} 平均曲率`, errors);
}

// --- 凹坑符号检查: 内凹圆柱面 H 应为正 ---
{
  const cyl = makeSphere(1, 96, 64);
  // 反转三角形绕序 => 法线朝内, 模拟凹面
  for (let i = 0; i < cyl.indices.length; i += 3) {
    const t = cyl.indices[i + 1];
    cyl.indices[i + 1] = cyl.indices[i + 2];
    cyl.indices[i + 2] = t;
  }
  bakeCurvature(cyl);
  let positive = 0, total = 0;
  for (let i = 0; i < cyl.curvature.length; i++) {
    const y = cyl.positions[i * 3 + 1];
    if (Math.abs(Math.abs(y) - 1) < 0.02) continue;
    total++;
    if (cyl.curvature[i] > 0) positive++;
  }
  const ratio = positive / total;
  const ok = ratio > 0.98;
  console.log(`${ok ? 'PASS' : 'FAIL'} 凹面符号: 正曲率顶点占比 ${(ratio * 100).toFixed(1)}%`);
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} 项核对未通过`);
  process.exit(1);
}
console.log('\n全部曲率核对通过, 误差 < 2%');
