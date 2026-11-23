// 减面保形质量: 高细分球减面 70% 后, 平均曲率仍应接近 -1/R, 顶点位置不明显偏离球面
import { decimate } from '../src/core/Decimate';
import { bakeCurvature } from '../src/core/MeshBake';
import { Mesh, recomputeNormals, triangleCount } from '../src/core/Mesh';

function makeSphere(R: number, segU: number, segV: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    for (let u = 0; u <= segU; u++) {
      const theta = (u / segU) * Math.PI * 2;
      positions.push(R * Math.sin(phi) * Math.cos(theta), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(theta));
    }
  }
  const row = segU + 1;
  for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
    const a = v * row + u, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const mesh: Mesh = {
    name: 'sphere', positions: Float32Array.from(positions), normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices), curvature: new Float32Array(positions.length / 3),
    ao: new Float32Array(positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}

const R = 1;
const src = makeSphere(R, 120, 80);
const srcTri = triangleCount(src);
const target = Math.floor(srcTri * 0.3);
const dec = decimate(src, target);
bakeCurvature(dec);

// 1. 面数达标
const ratio = triangleCount(dec) / srcTri;
console.log(`减面比例: ${srcTri} -> ${triangleCount(dec)} (保留 ${(ratio * 100).toFixed(1)}%)`);

// 2. 位置偏差: 每个顶点到球心距离应接近 R
let maxDev = 0, sumDev = 0;
const n = dec.positions.length / 3;
for (let i = 0; i < n; i++) {
  const d = Math.abs(Math.hypot(dec.positions[i * 3], dec.positions[i * 3 + 1], dec.positions[i * 3 + 2]) - R);
  maxDev = Math.max(maxDev, d);
  sumDev += d;
}
const meanDev = sumDev / n;
console.log(`位置偏差: 平均 ${(meanDev * 100).toFixed(3)}% R, 最大 ${(maxDev * 100).toFixed(3)}% R`);

// 3. 曲率仍接近 -1 (排除极区)
const errs: number[] = [];
for (let i = 0; i < n; i++) {
  const y = dec.positions[i * 3 + 1];
  if (Math.abs(Math.abs(y) - R) < 0.05) continue;
  errs.push(Math.abs(dec.curvature[i] - -1 / R));
}
const meanCurvErr = errs.reduce((s, x) => s + x, 0) / errs.length;

// 对照基线: 同密度原生粗网格的离散化误差 (不减面也有, 属离散微分几何固有特性)
const coarseSeg = Math.round(Math.sqrt(triangleCount(dec) / 2));
const baseline = makeSphere(R, coarseSeg, Math.round(coarseSeg * 0.67));
bakeCurvature(baseline);
const baseErrs: number[] = [];
for (let i = 0; i < baseline.curvature.length; i++) {
  const y = baseline.positions[i * 3 + 1];
  if (Math.abs(Math.abs(y) - R) < 0.05) continue;
  baseErrs.push(Math.abs(baseline.curvature[i] - -1 / R));
}
const baselineErr = baseErrs.reduce((s, x) => s + x, 0) / baseErrs.length;
console.log(`减面后曲率平均绝对误差: ${meanCurvErr.toFixed(4)} (期望 H=-1)`);
console.log(`同密度原生粗网格基线误差: ${baselineErr.toFixed(4)} (离散化固有, 非减面引入)`);

// 验收: 减面达标 + 位置偏差 <3% R + 减面曲率误差不超过基线的 1.5 倍
const ok = triangleCount(dec) <= target * 1.05 && meanDev < 0.03 && meanCurvErr <= baselineErr * 1.5;
console.log(ok ? '\nPASS 减面保形质量验收通过 (曲率精度与同密度网格相当)' : '\nFAIL 减面保形质量不达标');
if (!ok) process.exit(1);
