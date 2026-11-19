import { el, table } from '../dom';
import { computeClearances } from '../../model/clearance';
import type { App } from '../app';

/** 交叉跨越页：按控制工况汇总每处跨越/障碍的最小距离 */
export function renderCrossingsPage(root: HTMLElement, app: App) {
  const st = app.store;
  const p = st.project;
  const hot = p.loadCases.find(c => c.id === 'maxtemp') ?? p.loadCases[0];
  const wind = p.loadCases.find(c => c.id === 'wind') ?? p.loadCases[0];

  const recHot = computeClearances(st, hot.id);
  const recWind = computeClearances(st, wind.id);

  const card = el('div', { class: 'card' },
    el('h2', {}, '交叉跨越与距离校核汇总'),
    el('p', { class: 'muted' },
      `对地/公路/低压线按「${hot.name}」（最大弧垂）校核；对树木按「${wind.name}」（风偏后）校核。点击行可在三维中定位。`));

  interface Row { kind: string; station: number; value: number; required: number; pass: boolean; caseName: string; }
  const rows: Row[] = [];
  // 每类对象取全局最小
  const kinds: ['ground' | 'tree' | 'road' | 'lvline', string][] = [
    ['ground', '对地（走廊）'], ['tree', '对树木'], ['road', '对公路'], ['lvline', '对低压线'],
  ];
  for (const [kind, label] of kinds) {
    const src = kind === 'tree' ? recWind : recHot;
    const recs = src.filter(r => r.kind === kind);
    if (!recs.length) continue;
    // 列出最小的 3 处
    recs.sort((a, b) => a.value - b.required - (b.value - b.required));
    for (const r of recs.slice(0, 3)) {
      rows.push({
        kind: label, station: r.station, value: r.value, required: r.required,
        pass: r.pass, caseName: kind === 'tree' ? wind.name : hot.name,
      });
    }
  }
  rows.sort((a, b) => Number(a.pass) - Number(b.pass) || (a.value - a.required) - (b.value - b.required));

  const t = table(['校核对象', '控制工况', '里程(m)', '实测距离(m)', '规范要求(m)', '裕度(m)', '结论'],
    rows.map(r => [
      r.kind, r.caseName, r.station.toFixed(0), r.value.toFixed(2),
      r.required.toFixed(1), (r.value - r.required).toFixed(2),
      r.pass ? '满足' : '不满足',
    ]),
    i => rows[i].pass ? '' : 'fail');
  // 点击定位
  Array.from(t.tBodies[0].rows).forEach((tr, i) => {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => app.focus3d(rows[i].station));
  });
  card.append(t);

  // 走廊要素清单
  const c = st.terrain.corridor;
  const listCard = el('div', { class: 'card' }, el('h2', {}, '走廊交叉跨越物'));
  listCard.append(table(['对象', '里程(m)', '说明'], [
    ['公路', c.road.station.toFixed(0), `路面宽 ${c.road.width} m`],
    ['低压线', c.lvLine.station.toFixed(0), `杆高 ${c.lvLine.poleHeight} m`],
    ['河流', c.river.station.toFixed(0), `宽 ${c.river.width.toFixed(0)} m（一般跨越）`],
    ['树林', '—', `${c.trees.length} 棵，分布在走廊两侧山坡`],
  ]));

  root.append(card, listCard);
}
