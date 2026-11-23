// 着色工序 / 材质 / 风化 / 方案的核心数据模型

/** 药剂类型 —— 对应厂里真实工序 */
export type ReagentId =
  | 'bareCopper'      // 铜本色 (打磨后基底)
  | 'k2s'             // 硫化钾烧黑
  | 'ammoniumSulfide' // 硫化铵 (温和发黑)
  | 'verdigrisGreen'  // 铜绿做旧 (碱式碳酸铜, 绿)
  | 'verdigrisBlue'   // 蓝铜绿 (碱式硫酸铜, 蓝)
  | 'liverOfSulfur'   // 石硫合剂 (褐黑)
  | 'waxPolish';      // 蜡封擦亮

export interface ReagentDef {
  id: ReagentId;
  name: string;
  /** 层的视觉族: 决定 shader 中的混合方式 */
  kind: 'base' | 'darken' | 'patinaGreen' | 'patinaBlue' | 'polish';
  /** 代表性颜色 (线性 sRGB 0..1, 参考值, 可在 UI 微调) */
  color: [number, number, number];
  metalness: number;
  roughness: number;
  description: string;
}

export const REAGENTS: Record<ReagentId, ReagentDef> = {
  bareCopper: {
    id: 'bareCopper', name: '铜本色 (打磨基底)', kind: 'base',
    color: [0.72, 0.35, 0.18], metalness: 1.0, roughness: 0.28,
    description: '铸铜打磨后的本色, 作为所有工序的基底',
  },
  k2s: {
    id: 'k2s', name: '硫化钾烧黑', kind: 'darken',
    color: [0.045, 0.04, 0.035], metalness: 0.7, roughness: 0.55,
    description: 'K₂S 热涂, 表面生成硫化铜黑膜',
  },
  ammoniumSulfide: {
    id: 'ammoniumSulfide', name: '硫化铵发黑', kind: 'darken',
    color: [0.08, 0.07, 0.06], metalness: 0.75, roughness: 0.5,
    description: '较温和的硫化发黑, 色调偏棕',
  },
  liverOfSulfur: {
    id: 'liverOfSulfur', name: '石硫合剂 (褐黑)', kind: 'darken',
    color: [0.1, 0.06, 0.035], metalness: 0.65, roughness: 0.6,
    description: '多硫化物, 出褐黑至古铜色层次',
  },
  verdigrisGreen: {
    id: 'verdigrisGreen', name: '铜绿 (碱式碳酸铜)', kind: 'patinaGreen',
    color: [0.18, 0.38, 0.24], metalness: 0.05, roughness: 0.85,
    description: '绿色铜锈, 凹处积存, 户外自然风化的主色调',
  },
  verdigrisBlue: {
    id: 'verdigrisBlue', name: '蓝铜绿 (碱式硫酸铜)', kind: 'patinaBlue',
    color: [0.12, 0.28, 0.42], metalness: 0.05, roughness: 0.8,
    description: '含硫环境下的蓝色铜锈, 常与绿锈交错',
  },
  waxPolish: {
    id: 'waxPolish', name: '蜡封擦亮', kind: 'polish',
    color: [0.55, 0.32, 0.14], metalness: 0.9, roughness: 0.22,
    description: '凸处擦亮出金属光, 凹处蜡质留住旧色',
  },
};

/** 一道着色工序 (图层) */
export interface ProcessLayer {
  id: string;
  reagent: ReagentId;
  /** 浓度 0..1 (UI 以百分比显示) */
  concentration: number;
  /** 施工遍数 1..5, 影响覆盖强度 */
  passes: number;
  /** 凹处偏好: 0=均匀, 1=只在凹处积色 (曲率/AO 驱动) */
  cavityBias: number;
  enabled: boolean;
  note?: string;
}

export type EnvironmentId = 'sunny' | 'overcast' | 'night';

export interface WeatheringParams {
  /** 风化年限 0..50 */
  years: number;
  /** 主导朝向 (度, 0 = +X), 决定铜绿偏好面 */
  facing: number;
  /** 淋雨方向 (世界空间单位向量的水平角+倾角) */
  rainAngle: number;
  rainTilt: number;
  /** 环境预设 */
  environment: EnvironmentId;
  /** 铜绿生长速率倍率 (厂区气候差异) */
  patinaRate: number;
  /** 雨痕强度 */
  streakStrength: number;
}

export const DEFAULT_WEATHERING: WeatheringParams = {
  years: 0,
  facing: 0,
  rainAngle: 270,
  rainTilt: 25,
  environment: 'sunny',
  patinaRate: 1,
  streakStrength: 0.7,
};

export interface Scheme {
  id: string;
  name: string;
  layers: ProcessLayer[];
  weathering: WeatheringParams;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  client?: string;
  note?: string;
  /** 几何来源标记 */
  source: 'procedural' | 'obj' | 'gltf';
  sourceFileName?: string;
  /** 减面目标 (0 表示不减) */
  decimateTarget: number;
  /** 烘焙参数 */
  rayCount: number;
  createdAt: number;
  updatedAt: number;
  schemes: Scheme[];
  activeSchemeId: string;
}

export function makeId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeDefaultLayers(): ProcessLayer[] {
  return [
    { id: makeId('lyr'), reagent: 'bareCopper', concentration: 1, passes: 1, cavityBias: 0, enabled: true },
    { id: makeId('lyr'), reagent: 'k2s', concentration: 0.85, passes: 2, cavityBias: 0.35, enabled: true },
    { id: makeId('lyr'), reagent: 'verdigrisGreen', concentration: 0.6, passes: 2, cavityBias: 0.8, enabled: true },
    { id: makeId('lyr'), reagent: 'waxPolish', concentration: 0.9, passes: 1, cavityBias: 0, enabled: true },
  ];
}

export function makeScheme(name = '默认方案'): Scheme {
  const now = Date.now();
  return {
    id: makeId('sch'),
    name,
    layers: makeDefaultLayers(),
    weathering: { ...DEFAULT_WEATHERING },
    updatedAt: now,
    createdAt: now,
  };
}
