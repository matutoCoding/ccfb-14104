import type { DesignStore } from '../model/store';
import { computeClearances } from '../model/clearance';

function download(name: string, content: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const row = (cells: (string | number)[]) => cells.join(',') + '\n';

/** 杆塔明细表 */
export function exportTowerSchedule(st: DesignStore) {
  let csv = row(['序号', '塔型', '类型', '呼高(m)', '里程(m)', '地面高程(m)', '串长(m)', '前档距(m)', '后档距(m)']);
  const ts = st.sortedTowers();
  const kindName = { suspension: '直线', strain: '耐张', angle: '耐张转角' };
  ts.forEach((t, i) => {
    const type = st.towerType(t);
    const prev = st.spans.find(s => s.rightTowerId === t.id)?.l;
    const next = st.spans.find(s => s.leftTowerId === t.id)?.l;
    csv += row([i + 1, type.name, kindName[type.kind], t.height, t.station.toFixed(1),
      st.towerGround(t).toFixed(1), t.insulatorLength,
      prev?.toFixed(1) ?? '-', next?.toFixed(1) ?? '-']);
  });
  download(`杆塔明细表-${st.project.name}.csv`, csv);
}

/** 各档弧垂表（所有工况） */
export function exportSagTable(st: DesignStore) {
  const cases = st.project.loadCases;
  let csv = row(['档号', '档距(m)', '高差(m)', '代表档距(m)', ...cases.map(c => `${c.name}弧垂(m)`)]);
  st.spans.forEach((span, i) => {
    const sec = st.sectionOf(span.id);
    const sags = st.spanSags(span);
    csv += row([i + 1, span.l.toFixed(1), span.h.toFixed(1), sec.repSpan.toFixed(1),
      ...cases.map(c => sags[c.id]?.toFixed(2) ?? '-')]);
  });
  download(`弧垂表-${st.project.name}.csv`, csv);
}

/** 交叉跨越及距离校核表：不满足的排最前面 */
export function exportClearanceTable(st: DesignStore) {
  // 按控制工况分别校核：对地/公路/低压线取最高温，对树取大风
  const hot = st.project.loadCases.find(c => c.id === 'maxtemp') ?? st.project.loadCases[0];
  const wind = st.project.loadCases.find(c => c.id === 'wind') ?? st.project.loadCases[0];
  const recHot = computeClearances(st, hot.id).filter(r => r.kind !== 'tree');
  const recWind = computeClearances(st, wind.id).filter(r => r.kind === 'tree');
  const all = [...recHot, ...recWind]
    .sort((a, b) => Number(a.pass) - Number(b.pass) || (a.value - a.required) - (b.value - b.required));
  let csv = row(['校核对象', '工况', '里程(m)', '实测距离(m)', '规范要求(m)', '裕度(m)', '结论']);
  for (const r of all) {
    const caseName = r.kind === 'tree' ? wind.name : hot.name;
    csv += row([r.kindLabel, caseName, r.station.toFixed(1), r.value.toFixed(2),
      r.required.toFixed(1), (r.value - r.required).toFixed(2), r.pass ? '满足' : '不满足']);
  }
  download(`交叉跨越校核表-${st.project.name}.csv`, csv);
}
