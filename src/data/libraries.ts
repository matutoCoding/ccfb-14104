import type { Conductor, TowerType, LoadCase, VoltageKv } from '../types';

/** 导线型号库（参数引自手册典型值） */
export const CONDUCTOR_LIBRARY: Conductor[] = [
  { id: 'LGJ-240/30', name: 'LGJ-240/30', area: 275.96, diameter: 21.60, unitWeight: 922.2 * 9.80665e-3, elasticModulus: 73000, thermalExpansion: 19.6e-6, rts: 75620, subConductors: 1, subSpacing: 0 },
  { id: 'LGJ-300/40', name: 'LGJ-300/40', area: 338.99, diameter: 23.94, unitWeight: 1133 * 9.80665e-3, elasticModulus: 73000, thermalExpansion: 19.6e-6, rts: 92220, subConductors: 1, subSpacing: 0 },
  { id: 'LGJ-400/35', name: 'LGJ-400/35', area: 425.24, diameter: 26.82, unitWeight: 1349 * 9.80665e-3, elasticModulus: 65000, thermalExpansion: 20.5e-6, rts: 103900, subConductors: 1, subSpacing: 0 },
  { id: 'LGJ-400/50', name: 'LGJ-400/50', area: 451.55, diameter: 27.63, unitWeight: 1511 * 9.80665e-3, elasticModulus: 69000, thermalExpansion: 19.3e-6, rts: 123400, subConductors: 1, subSpacing: 0 },
  { id: 'LGJ-500/45', name: 'LGJ-500/45', area: 531.68, diameter: 30.00, unitWeight: 1688 * 9.80665e-3, elasticModulus: 65000, thermalExpansion: 20.5e-6, rts: 128100, subConductors: 2, subSpacing: 0.4 },
  { id: 'LGJ-630/45', name: 'LGJ-630/45', area: 666.55, diameter: 33.60, unitWeight: 2060 * 9.80665e-3, elasticModulus: 63000, thermalExpansion: 20.9e-6, rts: 148700, subConductors: 4, subSpacing: 0.45 },
  { id: 'LGJ-720/50', name: 'LGJ-720/50', area: 775.41, diameter: 36.23, unitWeight: 2398 * 9.80665e-3, elasticModulus: 63700, thermalExpansion: 20.8e-6, rts: 170600, subConductors: 4, subSpacing: 0.45 },
];

/** 塔型库：Z 直线 / J 耐张转角 / N 耐张 */
export const TOWER_LIBRARY: TowerType[] = [
  // 110kV
  { id: 'ZM1-110', name: 'ZM1（直线）', kind: 'suspension', voltageKv: 110, heights: [15, 18, 21, 24], defaultHeight: 18, insulatorLength: 1.5, stringWeight: 800, stringWindArea: 0.6, maxSpan: 400 },
  { id: 'ZM2-110', name: 'ZM2（直线）', kind: 'suspension', voltageKv: 110, heights: [18, 21, 24, 27], defaultHeight: 21, insulatorLength: 1.5, stringWeight: 900, stringWindArea: 0.7, maxSpan: 500 },
  { id: 'J1-110', name: 'J1（耐张转角）', kind: 'angle', voltageKv: 110, heights: [15, 18, 21], defaultHeight: 18, insulatorLength: 1.6, stringWeight: 1200, stringWindArea: 0.8, maxSpan: 450 },
  // 220kV
  { id: 'ZM2-220', name: 'ZM2（直线）', kind: 'suspension', voltageKv: 220, heights: [21, 24, 27, 30], defaultHeight: 24, insulatorLength: 2.4, stringWeight: 1500, stringWindArea: 1.0, maxSpan: 550 },
  { id: 'ZGU2-220', name: 'ZGU2（直线）', kind: 'suspension', voltageKv: 220, heights: [24, 27, 30, 33], defaultHeight: 27, insulatorLength: 2.4, stringWeight: 1600, stringWindArea: 1.1, maxSpan: 650 },
  { id: 'J2-220', name: 'J2（耐张转角）', kind: 'angle', voltageKv: 220, heights: [18, 21, 24, 27], defaultHeight: 21, insulatorLength: 2.5, stringWeight: 2200, stringWindArea: 1.3, maxSpan: 500 },
  { id: 'N1-220', name: 'N1（耐张）', kind: 'strain', voltageKv: 220, heights: [18, 21, 24], defaultHeight: 21, insulatorLength: 2.5, stringWeight: 2000, stringWindArea: 1.2, maxSpan: 500 },
  // 330kV
  { id: 'ZM3-330', name: 'ZM3（直线）', kind: 'suspension', voltageKv: 330, heights: [27, 30, 33, 36], defaultHeight: 30, insulatorLength: 3.6, stringWeight: 2600, stringWindArea: 1.6, maxSpan: 700 },
  { id: 'J3-330', name: 'J3（耐张转角）', kind: 'angle', voltageKv: 330, heights: [24, 27, 30], defaultHeight: 27, insulatorLength: 3.7, stringWeight: 3800, stringWindArea: 2.0, maxSpan: 600 },
  // 500kV
  { id: 'ZB1-500', name: 'ZB1（直线）', kind: 'suspension', voltageKv: 500, heights: [30, 33, 36, 39, 42], defaultHeight: 36, insulatorLength: 5.0, stringWeight: 4500, stringWindArea: 2.4, maxSpan: 800 },
  { id: 'ZB2-500', name: 'ZB2（直线）', kind: 'suspension', voltageKv: 500, heights: [33, 36, 39, 42, 45], defaultHeight: 39, insulatorLength: 5.2, stringWeight: 5000, stringWindArea: 2.6, maxSpan: 900 },
  { id: 'J4-500', name: 'J4（耐张转角）', kind: 'angle', voltageKv: 500, heights: [27, 30, 33, 36], defaultHeight: 30, insulatorLength: 5.2, stringWeight: 7000, stringWindArea: 3.2, maxSpan: 700 },
  { id: 'N2-500', name: 'N2（耐张）', kind: 'strain', voltageKv: 500, heights: [27, 30, 33], defaultHeight: 30, insulatorLength: 5.2, stringWeight: 6500, stringWindArea: 3.0, maxSpan: 700 },
];

/** 默认气象工况（典型 II 类气象区） */
export function defaultLoadCases(): LoadCase[] {
  return [
    { id: 'maxtemp', name: '最高温', temperature: 40, windSpeed: 0, iceThickness: 0 },
    { id: 'mintemp', name: '最低温', temperature: -20, windSpeed: 0, iceThickness: 0 },
    { id: 'ice', name: '覆冰', temperature: -5, windSpeed: 10, iceThickness: 10 },
    { id: 'wind', name: '大风', temperature: 10, windSpeed: 30, iceThickness: 0 },
    { id: 'install', name: '安装', temperature: -10, windSpeed: 10, iceThickness: 0 },
    { id: 'avgtemp', name: '平均气温', temperature: 15, windSpeed: 0, iceThickness: 0 },
  ];
}

/** GB 50545 最小安全距离（m），按电压等级 */
export interface ClearanceStandard {
  ground: number;   // 对地（非居民区）
  slope: number;    // 步行可达山坡
  tree: number;     // 对树木（考虑风偏）
  road: number;     // 对公路路面
  powerLine: number;// 对被跨越电力线
}
export const CLEARANCE_STANDARDS: Record<VoltageKv, ClearanceStandard> = {
  110: { ground: 6.0, slope: 5.0, tree: 4.0, road: 7.0, powerLine: 3.0 },
  220: { ground: 6.5, slope: 5.5, tree: 4.5, road: 8.0, powerLine: 4.0 },
  330: { ground: 7.5, slope: 6.5, tree: 5.0, road: 9.0, powerLine: 5.0 },
  500: { ground: 11.0, slope: 8.5, tree: 7.0, road: 14.0, powerLine: 6.0 },
};

export function conductorById(id: string): Conductor {
  const c = CONDUCTOR_LIBRARY.find(c => c.id === id);
  if (!c) throw new Error('未知导线型号 ' + id);
  return c;
}
export function towerTypeById(id: string): TowerType {
  const t = TOWER_LIBRARY.find(t => t.id === id);
  if (!t) throw new Error('未知塔型 ' + id);
  return t;
}
