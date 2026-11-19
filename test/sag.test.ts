/**
 * 力学内核精度测试 —— 对标手算（《电力工程高压送电线路设计手册》公式）。
 * 验收标准：悬链线弧垂、状态方程应力与手算值误差 ≤ 0.5%。
 */
import { describe, it, expect } from 'vitest';
import { catenary, sigmaForSag } from '../src/math/catenary';
import { solveStateEquation, stateEquationResidual, representativeSpan } from '../src/math/stateEquation';
import { specificLoads } from '../src/math/loads';
import type { Conductor, LoadCase } from '../src/types';

// LGJ-400/35 钢芯铝绞线（手册典型参数）
const LGJ400: Conductor = {
  id: 'LGJ-400/35', name: 'LGJ-400/35',
  area: 425.24, diameter: 26.82,
  unitWeight: 1349 * 9.80665e-3, // 1349 kg/km → 13.229 N/m
  elasticModulus: 65000, thermalExpansion: 20.5e-6,
  rts: 103900, subConductors: 1, subSpacing: 0,
};

const G1 = LGJ400.unitWeight / LGJ400.area; // 0.031110… N/(m·mm²)

describe('比载计算', () => {
  it('自重比载 γ1 = W/A', () => {
    expect(G1).toBeCloseTo(0.031110, 5);
  });

  it('冰重比载 γ2 符合手册公式 27.728·b(d+b)/A×10⁻³', () => {
    const ice: LoadCase = { id: 'ice', name: '覆冰', temperature: -5, windSpeed: 10, iceThickness: 10 };
    const s = specificLoads(LGJ400, ice);
    // 手算：27.728×10×36.82/425.24×1e-3 = 0.024008
    expect(s.g2).toBeCloseTo(0.024008, 5);
    expect(s.g3).toBeCloseTo(G1 + s.g2, 10);
    // 覆冰风压比载 γ5 = 0.625×10²×(26.82+20)/425.24×1e-3
    expect(s.g5).toBeCloseTo(0.625 * 100 * 46.82e-3 / 425.24, 10);
    expect(s.g7).toBeCloseTo(Math.hypot(s.g3, s.g5), 12);
    expect(s.g).toBe(s.g7);
  });

  it('大风综合比载 γ6 = √(γ1²+γ4²)', () => {
    const wind: LoadCase = { id: 'wind', name: '大风', temperature: 10, windSpeed: 30, iceThickness: 0 };
    const s = specificLoads(LGJ400, wind);
    const g4 = 0.625 * 900 * 26.82e-3 / 425.24; // 0.035479
    expect(s.g4).toBeCloseTo(g4, 12);
    expect(s.g6).toBeCloseTo(Math.hypot(G1, g4), 12);
    expect(s.swingAngle).toBeCloseTo(Math.atan(g4 / G1), 12);
  });
});

describe('悬链线（水平档）', () => {
  // 手算对照：l=400m, h=0, σ0=50MPa, γ1=0.031110
  // 抛物线近似 f = γl²/(8σ0) = 0.031110×160000/400 = 12.444 m
  // 级数精确值 f = a(cosh u − 1), a=1607.17, u=0.124385 → 12.441 m
  const c = catenary(400, 0, 50, G1);

  it('最大弧垂与抛物线手算值误差 < 0.5%', () => {
    const hand = G1 * 400 * 400 / (8 * 50); // 12.444
    expect(Math.abs(c.maxSag - hand) / hand).toBeLessThan(0.005);
  });

  it('最大弧垂与级数展开精确解一致', () => {
    const a = 50 / G1;
    const u = 400 / (2 * a);
    // 独立级数：cosh u − 1 = u²/2 + u⁴/24 + u⁶/720
    const series = a * (u * u / 2 + u ** 4 / 24 + u ** 6 / 720);
    expect(c.maxSag).toBeCloseTo(series, 6);
  });

  it('最低点在档距中央，端点高程为 0', () => {
    expect(c.x0).toBeCloseTo(200, 6);
    expect(c.y(0)).toBeCloseTo(0, 10);
    expect(c.y(400)).toBeCloseTo(0, 10);
    expect(c.y(200)).toBeCloseTo(-c.maxSag, 6);
  });

  it('线长 = 2a·sinh(l/2a)，与弧垂近似公式互洽', () => {
    const a = 50 / G1;
    expect(c.length).toBeCloseTo(2 * a * Math.sinh(200 / a), 8);
    // 近似 L ≈ l + 8f²/(3l)
    const approx = 400 + 8 * c.maxSag ** 2 / (3 * 400);
    expect(Math.abs(c.length - approx) / c.length).toBeLessThan(0.001);
  });

  it('挂点应力 σ = σ0·cosh(x0/a)，比 σ0 略大', () => {
    const a = 50 / G1;
    expect(c.sigmaA).toBeCloseTo(50 * Math.cosh(200 / a), 8);
    expect(c.sigmaA).toBeGreaterThan(50);
    expect(c.sigmaA).toBeLessThan(50 * 1.01);
  });
});

describe('悬链线（高差档 l=400, h=80）', () => {
  const c = catenary(400, 80, 50, G1);

  it('端点条件 y(0)=0, y(l)=h 精确成立', () => {
    expect(c.y(0)).toBeCloseTo(0, 10);
    expect(c.y(400)).toBeCloseTo(80, 8);
  });

  it('最大弧垂与手册近似 γl²/(8σ0·cosβ) 误差 < 0.5%', () => {
    const cosB = 400 / Math.hypot(400, 80);
    const hand = G1 * 400 * 400 / (8 * 50 * cosB);
    expect(Math.abs(c.maxSag - hand) / hand).toBeLessThan(0.005);
  });

  it('线长 = 2a·sinh(l/2a)·cosh(β)', () => {
    const a = 50 / G1;
    const beta = Math.asinh(80 / (2 * a * Math.sinh(200 / a)));
    expect(c.length).toBeCloseTo(2 * a * Math.sinh(200 / a) * Math.cosh(beta), 8);
    expect(c.length).toBeGreaterThan(Math.hypot(400, 80));
  });

  it('高挂点应力大于低挂点应力', () => {
    expect(c.sigmaB).toBeGreaterThan(c.sigmaA);
  });
});

describe('由弧垂反算应力', () => {
  it('sigmaForSag 往返一致', () => {
    const c = catenary(350, 20, 60, G1);
    const sigma = sigmaForSag(350, 20, G1, c.maxSag);
    expect(sigma).toBeCloseTo(60, 4);
  });
});

describe('状态方程', () => {
  // 手算例题：E=65000, α=20.5e-6, lr=300
  // 工况m（覆冰）：t=-5, γm=0.055118(γ7), σm=100MPa
  // 工况n（最高温）：t=+40, γn=γ1=0.031110
  const base = {
    sigmaM: 100, gammaM: 0.055118, tempM: -5,
    gammaN: G1, tempN: 40,
    lr: 300, E: 65000, alpha: 20.5e-6,
  };

  it('牛顿解与独立二分法手算结果一致（<0.5%）', () => {
    const sigma = solveStateEquation(base);
    // 独立二分求解 σ³ − Aσ² − B = 0
    const A = base.sigmaM - (base.E * base.gammaM ** 2 * base.lr ** 2) / (24 * base.sigmaM ** 2)
      - base.alpha * base.E * (base.tempN - base.tempM);
    const B = (base.E * base.gammaN ** 2 * base.lr ** 2) / 24;
    let lo = 0.01, hi = 500;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      (mid ** 3 - A * mid ** 2 - B > 0) ? hi = mid : lo = mid;
    }
    const ref = (lo + hi) / 2;
    expect(Math.abs(sigma - ref) / ref).toBeLessThan(0.005);
    expect(Math.abs(stateEquationResidual(base, sigma))).toBeLessThan(1e-6);
  });

  it('数值符合手算量级（σn ≈ 52.3 MPa）', () => {
    // 手算：A = 100 − 65000×0.055118²×300²/(24×100²) − 20.5e-6×65000×45 = −34.01
    // B = 65000×0.031110²×300²/24 = 235900，解 σ³+34.01σ²−235900=0 → σ≈52.3
    const sigma = solveStateEquation(base);
    expect(sigma).toBeGreaterThan(51.5);
    expect(sigma).toBeLessThan(53.5);
  });

  it('往返求解还原基准应力', () => {
    const sigmaN = solveStateEquation(base);
    const back = solveStateEquation({
      sigmaM: sigmaN, gammaM: base.gammaN, tempM: base.tempN,
      gammaN: base.gammaM, tempN: base.tempM,
      lr: base.lr, E: base.E, alpha: base.alpha,
    });
    expect(back).toBeCloseTo(base.sigmaM, 6);
  });

  it('温度升高应力下降，覆冰应力大于最高温应力', () => {
    const hot = solveStateEquation(base);
    const cold = solveStateEquation({ ...base, gammaN: G1, tempN: -40 });
    expect(cold).toBeGreaterThan(hot);
    expect(hot).toBeLessThan(base.sigmaM);
  });
});

describe('代表档距', () => {
  it('lr = √(Σl³/Σl)', () => {
    expect(representativeSpan([300, 400, 350])).toBeCloseTo(
      Math.sqrt((300 ** 3 + 400 ** 3 + 350 ** 3) / 1050), 10);
  });
});
