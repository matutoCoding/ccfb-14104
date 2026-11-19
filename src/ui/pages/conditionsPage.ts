import { el, field, numberInput, select, table } from '../dom';
import { CONDUCTOR_LIBRARY } from '../../data/libraries';
import { specificLoads } from '../../math/loads';
import { catenary } from '../../math/catenary';
import type { App } from '../app';

export function renderConditionsPage(root: HTMLElement, app: App) {
  const st = app.store;
  const p = st.project;
  const c = st.conductor;

  // ---- 导线型号 ----
  const condCard = el('div', { class: 'card' }, el('h2', {}, '导线型号'));
  condCard.append(
    field('型号', select(CONDUCTOR_LIBRARY.map(x => [x.id, x.name] as [string, string]),
      c.id, v => app.mutate(() => { p.conductorId = v; }))),
    table(['截面积(mm²)', '外径(mm)', '单位重(N/m)', '弹性模量(MPa)', '线膨胀系数(1/°C)', '拉断力(N)', '分裂数/间距'],
      [[c.area, c.diameter, c.unitWeight.toFixed(3), c.elasticModulus,
        (c.thermalExpansion * 1e6).toFixed(1) + 'e-6', c.rts,
        `${c.subConductors} 分裂 / ${c.subSpacing} m`]]),
    el('p', { class: 'muted' }, `基准控制应力 σ = ${p.refSigma.toFixed(1)} MPa（默认取拉断力/截面积/2.5 安全系数）`));

  // ---- 工况定义 ----
  const caseCard = el('div', { class: 'card' }, el('h2', {}, '气象工况（可修改数值）'));
  caseCard.append(table(['工况', '温度(°C)', '风速(m/s)', '覆冰(mm)', '综合比载 γ (N/m·mm²)', '设为控制工况'],
    p.loadCases.map(lc => {
      const g = specificLoads(st.conductor, lc).g;
      return [
        lc.name,
        numberInput(lc.temperature, v => app.mutate(() => lc.temperature = v), 1),
        numberInput(lc.windSpeed, v => app.mutate(() => lc.windSpeed = v), 1),
        numberInput(lc.iceThickness, v => app.mutate(() => lc.iceThickness = v), 1),
        g.toFixed(5),
        p.refCaseId === lc.id ? el('span', { class: 'tag' }, '控制工况')
          : (() => {
            const b = el('button', { class: 'ghost' }, '设为');
            b.addEventListener('click', () => app.mutate(() => { p.refCaseId = lc.id; }));
            return b;
          })(),
      ];
    })));
  caseCard.append(
    field('控制工况应力 σm (MPa)', numberInput(p.refSigma, v => app.mutate(() => p.refSigma = v), 1)));

  // ---- 当前工况切换 ----
  const activeCard = el('div', { class: 'card' }, el('h2', {}, '当前校核工况'));
  activeCard.append(field('工况', select(
    p.loadCases.map(lc => [lc.id, lc.name] as [string, string]),
    st.activeCaseId, v => { st.activeCaseId = v; st.recompute(); app.renderPage(); })));

  // ---- 状态方程结果 ----
  const resCard = el('div', { class: 'card' }, el('h2', {}, '状态方程结果：各耐张段水平应力 σ0 (MPa)'));
  if (st.sections.length) {
    resCard.append(table(['耐张段', '代表档距(m)', ...p.loadCases.map(lc => lc.name)],
      st.sections.map((s, i) => [
        `#${i + 1}`, s.repSpan.toFixed(1),
        ...p.loadCases.map(lc => s.sigma0[lc.id]?.toFixed(2) ?? '-'),
      ])));
  }

  // ---- 各档弧垂（当前工况） ----
  const sagCard = el('div', { class: 'card' }, el('h2', {}, `各档弧垂（${st.activeCase.name}）`));
  if (st.spans.length) {
    sagCard.append(table(['档号', '档距(m)', '高差(m)', 'σ0(MPa)', '最大弧垂(m)', '抛物线近似(m)', '偏差'],
      st.spans.map((span, i) => {
        const geo = st.spanGeometry(span, st.activeCaseId, 8);
        const sec = st.sectionOf(span.id);
        const loads = specificLoads(st.conductor, st.activeCase);
        const cat = catenary(span.l, span.h, sec.sigma0[st.activeCaseId] ?? 50, loads.g);
        const dev = Math.abs(cat.maxSag - cat.approxSag) / cat.maxSag * 100;
        return [i + 1, span.l.toFixed(1), span.h.toFixed(1),
          geo.sigma0.toFixed(2), cat.maxSag.toFixed(2), cat.approxSag.toFixed(2),
          dev.toFixed(2) + '%'];
      })));
  }

  root.append(condCard, caseCard, activeCard, resCard, sagCard);
}
