import { el, button, table } from '../dom';
import { exportTowerSchedule, exportSagTable, exportClearanceTable } from '../../export/csv';
import { computeClearances } from '../../model/clearance';
import type { App } from '../app';

export function renderOutputPage(root: HTMLElement, app: App) {
  const st = app.store;
  const p = st.project;

  // ---- 导出 ----
  const exportCard = el('div', { class: 'card' }, el('h2', {}, '成果导出（CSV，Excel 可直接打开）'));
  exportCard.append(el('div', { class: 'toolbar' },
    button('导出杆塔明细表', () => exportTowerSchedule(st), 'primary'),
    button('导出各档弧垂表', () => exportSagTable(st), 'primary'),
    button('导出交叉跨越校核表', () => exportClearanceTable(st), 'primary')));

  // ---- 预览：杆塔明细 ----
  const ts = st.sortedTowers();
  const towerCard = el('div', { class: 'card' }, el('h2', {}, '杆塔明细预览'));
  towerCard.append(table(['#', '塔型', '呼高(m)', '里程(m)', '前档(m)', '后档(m)'],
    ts.map((t, i) => {
      const type = st.towerType(t);
      return [i + 1, type.name, t.height, t.station.toFixed(1),
        st.spans.find(s => s.rightTowerId === t.id)?.l.toFixed(0) ?? '-',
        st.spans.find(s => s.leftTowerId === t.id)?.l.toFixed(0) ?? '-'];
    })));

  // ---- 预览：弧垂表 ----
  const cases = p.loadCases;
  const sagCard = el('div', { class: 'card' }, el('h2', {}, '各档弧垂预览（m）'));
  sagCard.append(table(['档号', '档距(m)', '高差(m)', ...cases.map(c => c.name)],
    st.spans.map((span, i) => {
      const sags = st.spanSags(span);
      return [i + 1, span.l.toFixed(0), span.h.toFixed(1),
        ...cases.map(c => sags[c.id]?.toFixed(2) ?? '-')];
    })));

  // ---- 预览：校核表（不满足在前） ----
  const hot = cases.find(c => c.id === 'maxtemp') ?? cases[0];
  const wind = cases.find(c => c.id === 'wind') ?? cases[0];
  const all = [
    ...computeClearances(st, hot.id).filter(r => r.kind !== 'tree'),
    ...computeClearances(st, wind.id).filter(r => r.kind === 'tree'),
  ].sort((a, b) => Number(a.pass) - Number(b.pass) || (a.value - a.required) - (b.value - b.required));
  const chkCard = el('div', { class: 'card' }, el('h2', {}, '距离校核预览（不满足的排在最前）'));
  chkCard.append(table(['对象', '工况', '里程(m)', '实测(m)', '要求(m)', '结论'],
    all.map(r => [r.kindLabel, r.kind === 'tree' ? wind.name : hot.name,
      r.station.toFixed(0), r.value.toFixed(2), r.required.toFixed(1),
      r.pass ? '满足' : '不满足']),
    i => all[i].pass ? '' : 'fail'));

  root.append(exportCard, towerCard, sagCard, chkCard);
}
