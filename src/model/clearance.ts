import type { ClearanceRecord } from '../types';
import type { DesignStore } from './store';

const KIND_LABEL: Record<ClearanceRecord['kind'], string> = {
  ground: '对地', tree: '对树木', road: '对公路', lvline: '对低压线',
};

function dist3(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 对指定工况逐档计算：对地、对树、对公路、对低压线最小距离。
 * 返回每档每类的最小值记录（含最近点对，供三维画连线）。
 */
export function computeClearances(store: DesignStore, caseId: string): ClearanceRecord[] {
  const records: ClearanceRecord[] = [];
  const std = store.standards;
  const { trees, road, lvLine } = store.terrain.corridor;
  const groundAt = store.terrain.groundAt;

  // 低压线采样点（横跨走廊，高度 = 地面 + 杆高，略带弧垂）
  const lvPts: [number, number, number][] = [];
  for (let y = -80; y <= 80; y += 4) {
    const sag = 1.2 * (1 - (y / 80) ** 2);
    lvPts.push([lvLine.station, y, groundAt(lvLine.station, y) + lvLine.poleHeight - sag]);
  }

  for (const span of store.spans) {
    const geo = store.spanGeometry(span, caseId, 48);
    const best: Partial<Record<ClearanceRecord['kind'], ClearanceRecord>> = {};
    const consider = (kind: ClearanceRecord['kind'], value: number, required: number,
      a: [number, number, number], b: [number, number, number]) => {
      const cur = best[kind];
      if (!cur || value < cur.value) {
        best[kind] = {
          kind, kindLabel: KIND_LABEL[kind], spanId: span.id,
          station: a[0], value, required, pass: value >= required, a, b,
        };
      }
    };

    for (const p of geo.points) {
      const [x, y, z] = p;
      // 对地
      consider('ground', z - groundAt(x, y), std.ground, p, [x, y, groundAt(x, y)]);
      // 对公路（公路带内）
      if (Math.abs(x - road.station) <= road.width / 2 + 2 && Math.abs(y) <= 60) {
        const rz = groundAt(road.station, y);
        consider('road', z - rz, std.road, p, [road.station, y, rz]);
      }
      // 对低压线
      if (Math.abs(x - lvLine.station) <= 30) {
        for (const q of lvPts) {
          const d = dist3(p, q);
          consider('lvline', d, std.powerLine, p, q);
        }
      }
    }
    // 对树（空间预筛选：档走廊 80m 内）
    const x0 = Math.min(geo.attachL[0], geo.attachR[0]) - 20;
    const x1 = Math.max(geo.attachL[0], geo.attachR[0]) + 20;
    const nearTrees = trees.filter(t => t.x > x0 && t.x < x1 && Math.abs(t.y) < 80);
    if (nearTrees.length) {
      for (const p of geo.points) {
        for (const t of nearTrees) {
          const dx = t.x - p[0], dy = t.y - p[1];
          if (dx * dx + dy * dy > 60 * 60) continue;
          const top: [number, number, number] = [t.x, t.y, groundAt(t.x, t.y) + t.h];
          consider('tree', dist3(p, top), std.tree, p, top);
        }
      }
    }
    records.push(...Object.values(best));
  }
  return records;
}
