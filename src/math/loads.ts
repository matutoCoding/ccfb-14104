import type { Conductor, LoadCase } from '../types';

/**
 * 导线比载 γ，单位 N/(m·mm²)。
 * 依据《电力工程高压送电线路设计手册》：
 *  γ1 自重比载 = 单位重量 / 截面积
 *  γ2 冰重比载 = 27.728·b(d+b)/A ×10⁻³
 *  γ3 = γ1+γ2（覆冰时垂直总比载）
 *  γ4 无冰风压比载 = 0.625·v²·d/A ×10⁻³   (风压不均匀系数、风载体型系数取 1)
 *  γ5 覆冰风压比载 = 0.625·v²·(d+2b)/A ×10⁻³
 *  γ6 = √(γ1²+γ4²)（无冰有风综合比载）
 *  γ7 = √(γ3²+γ5²)（覆冰有风综合比载）
 */
export interface SpecificLoads {
  g1: number; g2: number; g3: number;
  g4: number; g5: number; g6: number; g7: number;
  /** 该工况计算用综合比载 */
  g: number;
  /** 风偏角 rad：atan(风比载 / 垂直比载) */
  swingAngle: number;
}

export function specificLoads(c: Conductor, lc: LoadCase): SpecificLoads {
  const A = c.area;
  const d = c.diameter;
  const b = lc.iceThickness;
  const v = lc.windSpeed;

  const g1 = c.unitWeight / A;
  const g2 = b > 0 ? (27.728 * b * (d + b)) / A * 1e-3 : 0;
  const g3 = g1 + g2;
  const wp = 0.625 * v * v; // 基本风压 N/m²
  const g4 = v > 0 ? (wp * d * 1e-3) / A : 0;
  const g5 = v > 0 && b > 0 ? (wp * (d + 2 * b) * 1e-3) / A : 0;
  const g6 = Math.hypot(g1, g4);
  const g7 = Math.hypot(g3, g5);

  const iced = b > 0;
  const g = iced ? g7 : v > 0 ? g6 : g1;
  const gV = iced ? g3 : g1;         // 垂直分量
  const gW = iced ? g5 : g4;         // 水平（风）分量
  const swingAngle = gW > 0 ? Math.atan(gW / gV) : 0;

  return { g1, g2, g3, g4, g5, g6, g7, g, swingAngle };
}
