/**
 * 集成冒烟测试：生成走廊 → 自动排位 → 重算 → 校核，
 * 验证整条计算链无 NaN、结果量级合理。
 */
import { describe, it, expect } from 'vitest';
import { DesignStore } from '../src/model/store';
import { generateTerrain } from '../src/model/terrain';
import { autoSpot } from '../src/model/autoSpot';
import { defaultLoadCases, TOWER_LIBRARY, conductorById } from '../src/data/libraries';
import type { Project } from '../src/types';

function makeStore(): DesignStore {
  const st = new DesignStore();
  const project: Project = {
    id: 'p1', name: '测试工程', voltageKv: 220, conductorId: 'LGJ-400/35',
    corridorLength: 3000, terrainSeed: 12345, createdAt: 0,
    refCaseId: 'ice',
    refSigma: conductorById('LGJ-400/35').rts / conductorById('LGJ-400/35').area / 2.5,
    loadCases: defaultLoadCases(),
  };
  st.project = project;
  st.terrain = generateTerrain(project.terrainSeed, project.corridorLength);
  const susp = TOWER_LIBRARY.find(t => t.voltageKv === 220 && t.kind === 'suspension')!;
  const strain = TOWER_LIBRARY.find(t => t.voltageKv === 220 && t.kind !== 'suspension')!;
  st.towers = autoSpot(st, {
    typeId: susp.id, height: susp.defaultHeight,
    maxSpan: susp.maxSpan, minSpan: 150, margin: 1.0, strainTypeId: strain.id,
  });
  st.recompute();
  return st;
}

describe('自动排位 + 全链路计算', () => {
  const st = makeStore();

  it('自动排位产生合理的塔数和档距', () => {
    expect(st.towers.length).toBeGreaterThanOrEqual(4);
    expect(st.towers.length).toBeLessThanOrEqual(25);
    for (const span of st.spans) {
      expect(span.l).toBeGreaterThanOrEqual(100);
      expect(span.l).toBeLessThanOrEqual(650);
    }
    // 首末为耐张塔
    const ts = st.sortedTowers();
    expect(st.towerType(ts[0]).kind).not.toBe('suspension');
    expect(st.towerType(ts[ts.length - 1]).kind).not.toBe('suspension');
  });

  it('耐张段与各工况应力均为有限正数', () => {
    expect(st.sections.length).toBeGreaterThanOrEqual(1);
    for (const sec of st.sections) {
      expect(sec.repSpan).toBeGreaterThan(0);
      for (const lc of st.project.loadCases) {
        const s = sec.sigma0[lc.id];
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeGreaterThan(5);
        expect(s).toBeLessThan(200);
      }
      // 最高温应力 < 最低温应力（热胀冷缩）
      expect(sec.sigma0['maxtemp']).toBeLessThan(sec.sigma0['mintemp']);
    }
  });

  it('最高温弧垂 > 最低温弧垂，且量级合理', () => {
    for (const span of st.spans) {
      const sags = st.spanSags(span);
      expect(sags['maxtemp']).toBeGreaterThan(sags['mintemp']);
      expect(sags['maxtemp']).toBeGreaterThan(1);
      expect(sags['maxtemp']).toBeLessThan(60);
    }
  });

  it('三维几何点有限且风偏工况有横向偏移', () => {
    st.activeCaseId = 'wind';
    const geo = st.spanGeometry(st.spans[0], 'wind', 16);
    for (const p of geo.points) {
      expect(p.every(Number.isFinite)).toBe(true);
    }
    const midY = Math.abs(geo.points[8][1]);
    expect(midY).toBeGreaterThan(0.1); // 大风工况导线应偏出线路竖直面
  });

  it('距离校核结果完整', () => {
    st.activeCaseId = 'maxtemp';
    st.recompute();
    expect(st.clearances.length).toBeGreaterThan(0);
    for (const r of st.clearances) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThan(0);
    }
    // 自动排位带 1m 裕度，对地应全部满足
    const groundFails = st.clearances.filter(r => r.kind === 'ground' && !r.pass);
    expect(groundFails.length).toBe(0);
  });

  it('拖动杆塔后档距与校核实时更新', () => {
    const before = st.spans[1].l;
    const ts = st.sortedTowers();
    ts[1].station += 40;
    st.recompute();
    expect(st.spans[1].l).toBeCloseTo(before - 40, 6);
    expect(st.clearances.length).toBeGreaterThan(0);
  });
});
