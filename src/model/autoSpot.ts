import type { Tower } from '../types';
import { towerTypeById, CLEARANCE_STANDARDS } from '../data/libraries';
import { specificLoads } from '../math/loads';
import { catenary } from '../math/catenary';
import { solveStateEquation, representativeSpan } from '../math/stateEquation';
import type { DesignStore } from './store';
import { newId } from './store';

export interface AutoSpotOptions {
  typeId: string;     // 直线塔塔型
  height: number;     // 呼高
  maxSpan: number;
  minSpan: number;
  margin: number;     // 附加裕度 m
  strainTypeId: string; // 两端耐张塔塔型
}

/**
 * 一键自动排位：从走廊起点向终点贪心布塔，
 * 在满足对地/公路/低压线距离（最高温工况 + 裕度）前提下档距尽量大、塔数尽量少。
 */
export function autoSpot(store: DesignStore, opts: AutoSpotOptions): Tower[] {
  const p = store.project;
  const L = p.corridorLength;
  const std = CLEARANCE_STANDARDS[p.voltageKv];
  const conductor = store.conductor;
  const gAt = store.terrain.groundAt;
  const { road, lvLine, river } = store.terrain.corridor;
  // 控制工况：最高温（最大弧垂）
  const hotCase = p.loadCases.find(c => c.id === 'maxtemp') ?? p.loadCases[0];
  const g1 = specificLoads(conductor, hotCase).g;
  const refCase = p.loadCases.find(c => c.id === p.refCaseId) ?? p.loadCases[0];
  const gm = specificLoads(conductor, refCase).g;
  const type = towerTypeById(opts.typeId);
  const strainType = towerTypeById(opts.strainTypeId);

  const attachZ = (station: number, kind: 'suspension' | 'strain') => {
    const h = kind === 'suspension' ? opts.height : strainType.defaultHeight;
    const str = kind === 'suspension' ? type.insulatorLength : 0;
    return gAt(station, 0) + h - str;
  };

  /** 候选档 [s0, x] 是否满足距离要求 */
  function spanOk(s0: number, x: number, sectionSpans: number[]): boolean {
    const l = x - s0;
    const lr = representativeSpan([...sectionSpans, l]);
    const sigma = solveStateEquation({
      sigmaM: p.refSigma, gammaM: gm, tempM: refCase.temperature,
      gammaN: g1, tempN: hotCase.temperature,
      lr, E: conductor.elasticModulus, alpha: conductor.thermalExpansion,
    });
    const z0 = attachZ(s0, 'suspension');
    const z1 = x >= L - 1e-6 ? attachZ(x, 'strain') : attachZ(x, 'suspension');
    const c = catenary(l, z1 - z0, sigma, g1);
    for (let i = 0; i <= 32; i++) {
      const xx = (i / 32) * l;
      const station = s0 + xx;
      const z = z0 + ((z1 - z0) / l) * xx - c.sag(xx);
      const ground = gAt(station, 0);
      if (z - ground < std.ground + opts.margin) return false;
      if (Math.abs(station - road.station) <= road.width / 2 + 2) {
        if (z - ground < std.road + opts.margin) return false;
      }
      if (Math.abs(station - lvLine.station) <= 20) {
        const lvZ = ground + store.terrain.corridor.lvLine.poleHeight;
        if (z - lvZ < std.powerLine + opts.margin) return false;
      }
    }
    return true;
  }

  /** 塔位是否可用（避开河道、公路带） */
  function siteOk(x: number): boolean {
    if (Math.abs(x - river.station) < river.width / 2 + 8) return false;
    if (Math.abs(x - road.station) < road.width / 2 + 5) return false;
    return true;
  }

  const towers: Tower[] = [];
  const mk = (station: number, typeId: string, height: number, ins: number): Tower => ({
    id: newId('t'), projectId: p.id, station, typeId, height, insulatorLength: ins,
  });
  towers.push(mk(0, strainType.id, strainType.defaultHeight, strainType.insulatorLength));

  let s = 0;
  let sectionSpans: number[] = [];
  let guard = 0;
  while (s < L - opts.minSpan && guard++ < 500) {
    const hi = Math.min(s + opts.maxSpan, L);
    // 能直达终点则尽量直达
    if (hi >= L && spanOk(s, L, sectionSpans) && siteOk(L)) {
      sectionSpans.push(L - s);
      break;
    }
    // 从最大档距向下扫描第一个可行且塔位可用的位置，再向上微调
    let placed = 0;
    for (let x = hi; x >= s + opts.minSpan; x -= 10) {
      if (!siteOk(x)) continue;
      if (spanOk(s, x, sectionSpans)) {
        // 尝试向上精调（步长 2m）
        let best = x;
        for (let xx = x + 2; xx <= Math.min(x + 12, hi); xx += 2) {
          if (siteOk(xx) && spanOk(s, xx, sectionSpans)) best = xx;
        }
        placed = best;
        break;
      }
    }
    if (!placed) placed = Math.min(s + opts.minSpan, L); // 兜底：最小档距
    if (placed >= L - opts.minSpan) break;
    towers.push(mk(placed, type.id, opts.height, type.insulatorLength));
    sectionSpans.push(placed - s);
    s = placed;
  }
  towers.push(mk(L, strainType.id, strainType.defaultHeight, strainType.insulatorLength));
  return towers;
}
