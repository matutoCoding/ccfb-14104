/** 全局数据模型 */

export type VoltageKv = 110 | 220 | 330 | 500;

/** 导线型号（钢芯铝绞线等） */
export interface Conductor {
  id: string;
  name: string;            // 如 LGJ-400/35
  area: number;            // 综合截面积 mm²
  diameter: number;        // 外径 mm
  unitWeight: number;      // 单位重量 N/m
  elasticModulus: number;  // 弹性模量 E, MPa (N/mm²)
  thermalExpansion: number;// 线膨胀系数 α, 1/°C
  rts: number;             // 计算拉断力 N
  subConductors: number;   // 分裂数 1/2/4/6
  subSpacing: number;      // 分裂间距 m
}

export type TowerKind = 'suspension' | 'strain' | 'angle';

/** 塔型（塔型库条目） */
export interface TowerType {
  id: string;
  name: string;            // 如 ZM2、J1、ZGU2
  kind: TowerKind;
  voltageKv: VoltageKv;
  heights: number[];       // 可选呼高 m
  defaultHeight: number;   // 默认呼高 m
  insulatorLength: number; // 绝缘子串长 m（悬垂串；耐张串用于水平偏距，此处取挂线点下挂值）
  stringWeight: number;    // 悬垂串重 N
  stringWindArea: number;  // 串受风面积 m²
  maxSpan: number;         // 塔型允许最大档距 m
}

/** 已排位杆塔 */
export interface Tower {
  id: string;
  projectId: string;
  station: number;         // 沿中心线里程 m
  typeId: string;
  height: number;          // 呼高 m
  insulatorLength: number; // 串长 m（随塔型，可改）
}

/** 气象工况 */
export interface LoadCase {
  id: string;
  name: string;            // 最高温/最低温/覆冰/大风/安装/平均气温
  temperature: number;     // °C
  windSpeed: number;       // m/s
  iceThickness: number;    // mm
}

/** 线路工程 */
export interface Project {
  id: string;
  name: string;
  voltageKv: VoltageKv;
  conductorId: string;
  corridorLength: number;  // 走廊长度 m
  terrainSeed: number;
  createdAt: number;
  /** 状态方程基准：控制工况 id 与该工况下允许应力 MPa */
  refCaseId: string;
  refSigma: number;
  loadCases: LoadCase[];
}

/** 树 */
export interface Tree { x: number; y: number; h: number; r: number; }

/** 地形走廊（程序生成） */
export interface Corridor {
  id: string;
  projectId: string;
  seed: number;
  length: number;
  trees: Tree[];
  road: { station: number; width: number };       // 公路跨越
  lvLine: { station: number; poleHeight: number };// 低压线跨越
  river: { station: number; width: number };      // 河流
}

/** 档（两塔之间） */
export interface SpanInfo {
  id: string;
  sectionId: string;
  leftTowerId: string;
  rightTowerId: string;
  l: number;      // 档距 m（水平）
  h: number;      // 高差 m（右挂点 - 左挂点）
}

/** 耐张段 */
export interface TensionSection {
  id: string;
  towerIds: string[];      // 含两端耐张塔
  spanIds: string[];
  repSpan: number;         // 代表档距 m
  /** 各工况水平应力 σ0 (MPa)，key = loadCaseId */
  sigma0: Record<string, number>;
}

/** 校核不通过/预警项 */
export interface ClearanceRecord {
  kind: 'ground' | 'tree' | 'road' | 'lvline';
  kindLabel: string;
  spanId: string;
  station: number;         // 最近点里程
  value: number;           // 实测最小距离 m
  required: number;        // 规范要求 m
  pass: boolean;
  a: [number, number, number]; // 导线上最近点
  b: [number, number, number]; // 障碍物上最近点
}
