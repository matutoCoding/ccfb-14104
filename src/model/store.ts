import type {
  Project, Tower, SpanInfo, TensionSection, LoadCase, ClearanceRecord,
} from '../types';
import { conductorById, towerTypeById, CLEARANCE_STANDARDS } from '../data/libraries';
import { specificLoads } from '../math/loads';
import { catenary } from '../math/catenary';
import { solveStateEquation, representativeSpan } from '../math/stateEquation';
import type { Terrain } from './terrain';
import { computeClearances } from './clearance';

export interface SpanGeometry {
  span: SpanInfo;
  caseId: string;
  attachL: [number, number, number];
  attachR: [number, number, number];
  /** 单根子导线中心线采样点 */
  points: [number, number, number][];
  maxSag: number;
  sigma0: number;
  swingAngle: number; // 导线面风偏角 rad
}

let uid = 0;
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(uid++).toString(36)}`;
}

export class DesignStore {
  project!: Project;
  terrain!: Terrain;
  towers: Tower[] = [];
  activeCaseId = 'maxtemp';
  windYawDeg = 90;              // 风向与线路夹角，90=垂直线路
  sections: TensionSection[] = [];
  spans: SpanInfo[] = [];
  clearances: ClearanceRecord[] = [];

  private listeners = new Set<() => void>();
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { this.listeners.forEach(f => f()); }

  get conductor() { return conductorById(this.project.conductorId); }
  get activeCase(): LoadCase {
    return this.project.loadCases.find(c => c.id === this.activeCaseId) ?? this.project.loadCases[0];
  }
  get standards() { return CLEARANCE_STANDARDS[this.project.voltageKv]; }

  towerType(t: Tower) { return towerTypeById(t.typeId); }
  towerGround(t: Tower) { return this.terrain.groundAt(t.station, 0); }
  /** 横担（串挂点）高程 */
  crossarmZ(t: Tower) { return this.towerGround(t) + t.height; }

  sortedTowers(): Tower[] {
    return [...this.towers].sort((a, b) => a.station - b.station);
  }

  /** 重算：档位、耐张段、各工况应力、校核。拖杆塔时调用。 */
  recompute() {
    const ts = this.sortedTowers();
    this.spans = [];
    this.sections = [];
    if (ts.length >= 2) {
      let curSection: TensionSection | null = null;
      for (let i = 0; i < ts.length - 1; i++) {
        const L = ts[i], R = ts[i + 1];
        const span: SpanInfo = {
          id: `span-${L.id}-${R.id}`,
          sectionId: '',
          leftTowerId: L.id, rightTowerId: R.id,
          l: R.station - L.station,
          h: this.wireAttachZ(R, null) - this.wireAttachZ(L, null),
        };
        const kindL = this.towerType(L).kind;
        if (!curSection || kindL !== 'suspension') {
          curSection = { id: `sec-${L.id}`, towerIds: [L.id], spanIds: [], repSpan: 0, sigma0: {} };
          this.sections.push(curSection);
        }
        span.sectionId = curSection.id;
        curSection.spanIds.push(span.id);
        curSection.towerIds.push(R.id);
        this.spans.push(span);
      }
      // 各耐张段：代表档距 + 状态方程求各工况应力
      for (const sec of this.sections) {
        const ls = sec.spanIds.map(id => this.spans.find(s => s.id === id)!.l);
        sec.repSpan = representativeSpan(ls);
        const refCase = this.project.loadCases.find(c => c.id === this.project.refCaseId)
          ?? this.project.loadCases[0];
        const gm = specificLoads(this.conductor, refCase).g;
        for (const lc of this.project.loadCases) {
          const gn = specificLoads(this.conductor, lc).g;
          sec.sigma0[lc.id] = solveStateEquation({
            sigmaM: this.project.refSigma, gammaM: gm, tempM: refCase.temperature,
            gammaN: gn, tempN: lc.temperature,
            lr: sec.repSpan, E: this.conductor.elasticModulus,
            alpha: this.conductor.thermalExpansion,
          });
        }
      }
    }
    this.clearances = computeClearances(this, this.activeCaseId);
    this.emit();
  }

  sectionOf(spanId: string): TensionSection {
    return this.sections.find(s => s.spanIds.includes(spanId))!;
  }

  /** 无风（或指定工况）挂线点高程：悬垂塔 = 横担 − 串长；耐张/转角 = 横担 */
  wireAttachZ(t: Tower, _caseId: string | null): number {
    const kind = this.towerType(t).kind;
    return kind === 'suspension'
      ? this.crossarmZ(t) - t.insulatorLength
      : this.crossarmZ(t);
  }

  /** 悬垂串风偏角 rad（耐张塔为 0） */
  stringSwing(t: Tower, caseId: string): number {
    const type = this.towerType(t);
    if (type.kind !== 'suspension') return 0;
    const lc = this.project.loadCases.find(c => c.id === caseId)!;
    const loads = specificLoads(this.conductor, lc);
    const sinYaw = Math.sin(this.windYawDeg * Math.PI / 180);
    const gW = (lc.iceThickness > 0 ? loads.g5 : loads.g4) * sinYaw;
    if (gW <= 0) return 0;
    const gV = lc.iceThickness > 0 ? loads.g3 : loads.g1;
    const A = this.conductor.area;
    // 水平档距 / 垂直档距
    const idx = this.sortedTowers().findIndex(x => x.id === t.id);
    const ts = this.sortedTowers();
    const left = this.spans.find(s => s.rightTowerId === t.id);
    const right = this.spans.find(s => s.leftTowerId === t.id);
    const lh = ((left?.l ?? 0) + (right?.l ?? 0)) / 2 || 1;
    // 垂直档距：相邻两档最低点间水平距离
    const sigma = this.sections.find(s => s.towerIds.includes(t.id))?.sigma0[caseId] ?? 50;
    const lowX = (sp: SpanInfo | undefined, fromLeft: boolean) => {
      if (!sp) return t.station;
      const c = catenary(sp.l, sp.h, sigma, gV);
      return fromLeft ? (ts[idx - 1]?.station ?? 0) + c.x0 : t.station + c.x0;
    };
    const lv = Math.abs(lowX(right, false) - lowX(left, true)) || lh;
    const wp = 0.625 * lc.windSpeed * lc.windSpeed * sinYaw;
    const tanPhi = (wp * type.stringWindArea + gW * A * lh) / (type.stringWeight + gV * A * lv);
    return Math.atan(tanPhi);
  }

  /** 三维挂线点（含风偏摆动） */
  attachPoint(t: Tower, caseId: string): [number, number, number] {
    const zc = this.crossarmZ(t);
    const type = this.towerType(t);
    if (type.kind !== 'suspension') return [t.station, 0, zc];
    const phi = this.stringSwing(t, caseId);
    return [t.station, t.insulatorLength * Math.sin(phi), zc - t.insulatorLength * Math.cos(phi)];
  }

  /** 一档导线的三维几何（含风偏），samples 为采样点数 */
  spanGeometry(span: SpanInfo, caseId: string, samples = 48): SpanGeometry {
    const ts = this.sortedTowers();
    const L = ts.find(t => t.id === span.leftTowerId)!;
    const R = ts.find(t => t.id === span.rightTowerId)!;
    const attachL = this.attachPoint(L, caseId);
    const attachR = this.attachPoint(R, caseId);
    const sec = this.sectionOf(span.id);
    const sigma0 = sec?.sigma0[caseId] ?? 50;
    const lc = this.project.loadCases.find(c => c.id === caseId)!;
    const loads = specificLoads(this.conductor, lc);
    const sinYaw = Math.sin(this.windYawDeg * Math.PI / 180);
    const gV = lc.iceThickness > 0 ? loads.g3 : loads.g1;
    const gW = (lc.iceThickness > 0 ? loads.g5 : loads.g4) * sinYaw;
    const g = Math.hypot(gV, gW);
    const eta = gW > 0 ? Math.atan(gW / gV) : 0; // 导线面风偏角

    const dx = attachR[0] - attachL[0];
    const dy = attachR[1] - attachL[1];
    const l = Math.hypot(dx, dy);
    const h = attachR[2] - attachL[2];
    const c = catenary(l, h, sigma0, g);
    // 平面内单位向量 & 侧向单位向量
    const ux = dx / l, uy = dy / l;
    const px = -uy, py = ux; // 侧向（水平面内）

    const points: [number, number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const x = (i / samples) * l;
      const s = c.sag(x);
      const bx = attachL[0] + ux * x;
      const by = attachL[1] + uy * x;
      const bz = attachL[2] + (h / l) * x;
      points.push([
        bx + px * s * Math.sin(eta),
        by + py * s * Math.sin(eta),
        bz - s * Math.cos(eta),
      ]);
    }
    return { span, caseId, attachL, attachR, points, maxSag: c.maxSag, sigma0, swingAngle: eta };
  }

  /** 各工况最大弧垂（成果表用） */
  spanSags(span: SpanInfo): Record<string, number> {
    const sec = this.sectionOf(span.id);
    const out: Record<string, number> = {};
    for (const lc of this.project.loadCases) {
      const loads = specificLoads(this.conductor, lc);
      const sigma0 = sec?.sigma0[lc.id] ?? 50;
      out[lc.id] = catenary(span.l, span.h, sigma0, loads.g).maxSag;
    }
    return out;
  }

  refreshClearances() {
    this.clearances = computeClearances(this, this.activeCaseId);
    this.emit();
  }
}
