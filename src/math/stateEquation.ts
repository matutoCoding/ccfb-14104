/**
 * 导线状态方程（耐张段，代表档距法）：
 *
 *   σn − E·γn²·lr²/(24·σn²) = σm − E·γm²·lr²/(24·σm²) − α·E·(tn − tm)
 *
 * 整理为三次方程 σ³ − A·σ² − B = 0，牛顿法求解（初值取 max(A, B^(1/3))，恒收敛于正实根）。
 *
 * 代表档距 lr = √(Σlᵢ³/Σlᵢ)。
 */
export interface StateEquationInput {
  sigmaM: number;  // 已知工况应力 MPa
  gammaM: number;  // 已知工况比载 N/(m·mm²)
  tempM: number;   // 已知工况温度 °C
  gammaN: number;  // 待求工况比载
  tempN: number;   // 待求工况温度
  lr: number;      // 代表档距 m
  E: number;       // 弹性模量 MPa
  alpha: number;   // 线膨胀系数 1/°C
}

export function solveStateEquation(p: StateEquationInput): number {
  const { sigmaM, gammaM, tempM, gammaN, tempN, lr, E, alpha } = p;
  const A = sigmaM - (E * gammaM * gammaM * lr * lr) / (24 * sigmaM * sigmaM)
    - alpha * E * (tempN - tempM);
  const B = (E * gammaN * gammaN * lr * lr) / 24;

  // f(σ) = σ³ − Aσ² − B，f'(σ) = 3σ² − 2Aσ
  let s = Math.max(Math.abs(A), Math.cbrt(B), 1e-3);
  for (let i = 0; i < 60; i++) {
    const f = s * s * s - A * s * s - B;
    const df = 3 * s * s - 2 * A * s;
    const ds = f / df;
    s -= ds;
    if (s <= 0) s = 1e-3;
    if (Math.abs(ds) < 1e-12 * Math.max(1, s)) break;
  }
  return s;
}

/** 代表档距 lr = √(Σl³/Σl) */
export function representativeSpan(spans: number[]): number {
  if (spans.length === 0) return 0;
  let s3 = 0, s1 = 0;
  for (const l of spans) { s3 += l * l * l; s1 += l; }
  return Math.sqrt(s3 / s1);
}

/** 状态方程残差（供测试/自检） */
export function stateEquationResidual(p: StateEquationInput, sigmaN: number): number {
  const { sigmaM, gammaM, tempM, gammaN, tempN, lr, E, alpha } = p;
  const lhs = sigmaN - (E * gammaN * gammaN * lr * lr) / (24 * sigmaN * sigmaN);
  const rhs = sigmaM - (E * gammaM * gammaM * lr * lr) / (24 * sigmaM * sigmaM)
    - alpha * E * (tempN - tempM);
  return lhs - rhs;
}
