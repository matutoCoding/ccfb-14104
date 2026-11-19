/**
 * 悬链线精确解（高差档不用抛物线近似）。
 *
 * 坐标：x 自左挂点起算（水平），y 为相对左挂点的竖向高程（向上为正）。
 * 导线曲线：y(x) = a·[cosh((x−x0)/a) − cosh(x0/a)]，a = σ0/γ
 * 其中 x0 为最低点横坐标，由 y(0)=0、y(l)=h 解出：
 *   β = asinh( h / (2a·sinh(l/2a)) )，x0 = l/2 − a·β
 */
export interface Catenary {
  l: number;          // 档距 m
  h: number;          // 高差 m
  a: number;          // σ0/γ，悬链线参数 m
  x0: number;         // 最低点距左挂点水平距离 m
  /** 导线上 x 处的高程（相对左挂点） */
  y(x: number): number;
  /** x 处相对两挂点连线的弧垂（向下为正） */
  sag(x: number): number;
  /** 最大弧垂（对连线，在切线平行于连线处） */
  maxSag: number;
  /** 最大弧垂处距左挂点距离 */
  maxSagX: number;
  /** 档内导线长度 m */
  length: number;
  /** 左/右挂点处轴向应力 σ = σ0·cosh(...) (MPa) */
  sigmaA: number;
  sigmaB: number;
  /** 抛物线近似最大弧垂 γl²/(8σ0·cosβ)，用于和手算对照 */
  approxSag: number;
}

export function catenary(l: number, h: number, sigma0: number, gamma: number): Catenary {
  if (l <= 0) throw new Error('档距必须为正');
  if (sigma0 <= 0) throw new Error('应力必须为正');
  if (gamma <= 0) throw new Error('比载必须为正');
  const a = sigma0 / gamma;
  const u = l / (2 * a);
  const beta = Math.asinh(h / (2 * a * Math.sinh(u)));
  const x0 = l / 2 - a * beta;

  const y = (x: number) => a * (Math.cosh((x - x0) / a) - Math.cosh(x0 / a));
  const sag = (x: number) => (h / l) * x - y(x);

  // 最大弧垂位置：y'(x) = h/l → sinh((x−x0)/a) = h/l
  const maxSagX = x0 + a * Math.asinh(h / l);
  const maxSag = sag(maxSagX);

  // 线长：L = a·[sinh((l−x0)/a) + sinh(x0/a)] = 2a·sinh(u)·cosh(β)
  const length = 2 * a * Math.sinh(u) * Math.cosh(beta);

  const sigmaA = sigma0 * Math.cosh(x0 / a);
  const sigmaB = sigma0 * Math.cosh((l - x0) / a);

  const cosBeta = l / Math.hypot(l, h);
  const approxSag = (gamma * l * l) / (8 * sigma0 * cosBeta);

  return { l, h, a, x0, y, sag, maxSag, maxSagX, length, sigmaA, sigmaB, approxSag };
}

/**
 * 由目标最大弧垂反算水平应力（用于安装弧垂反推等）。
 * 二分求解 catenary(l,h,σ,γ).maxSag = targetSag。
 */
export function sigmaForSag(l: number, h: number, gamma: number, targetSag: number): number {
  let lo = 0.1, hi = 500;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const f = catenary(l, h, mid, gamma).maxSag;
    if (f > targetSag) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
