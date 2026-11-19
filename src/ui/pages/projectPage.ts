import { el, field, numberInput, select, button, table } from '../dom';
import { CONDUCTOR_LIBRARY } from '../../data/libraries';
import { generateTerrain } from '../../model/terrain';
import type { VoltageKv } from '../../types';
import type { App } from '../app';

export function renderProjectPage(root: HTMLElement, app: App) {
  const st = app.store;
  const p = st.project;

  // ---- 工程列表 ----
  const listCard = el('div', { class: 'card' }, el('h2', {}, '工程列表'));
  listCard.append(table(
    ['名称', '电压等级', '导线', '走廊长度(m)', '创建时间', '操作'],
    app.projects.map(pr => [
      pr.name, `${pr.voltageKv}kV`, pr.conductorId, pr.corridorLength,
      new Date(pr.createdAt).toLocaleDateString(),
      el('span', {},
        button(pr.id === p.id ? '当前工程' : '打开', () => {
          app.openProject(pr.id).then(() => app.renderPage());
        }, pr.id === p.id ? 'ghost' : ''),
        button('删除', () => {
          if (confirm(`删除工程「${pr.name}」？`)) app.deleteProject(pr.id).then(() => app.renderPage());
        }, 'danger')),
    ])));

  // ---- 新建工程 ----
  let name = `线路工程 ${app.projects.length + 1}`;
  let voltage: VoltageKv = 220;
  let conductorId = 'LGJ-400/35';
  let length = 3000;
  let seed = Math.floor(Math.random() * 1e6);
  const createCard = el('div', { class: 'card' }, el('h2', {}, '新建工程'));
  const nameInput = el('input', { value: name });
  nameInput.addEventListener('input', () => name = nameInput.value);
  createCard.append(
    field('工程名称', nameInput),
    field('电压等级', select([['110', '110kV'], ['220', '220kV'], ['330', '330kV'], ['500', '500kV']] as [string, string][],
      String(voltage), v => voltage = Number(v) as VoltageKv)),
    field('导线型号', select(CONDUCTOR_LIBRARY.map(c => [c.id, c.name] as [string, string]),
      conductorId, v => conductorId = v)),
    field('走廊长度 (m)', numberInput(length, v => length = v, 100)),
    field('地形种子', numberInput(seed, v => seed = v, 1)),
    button('创建并自动排位', async () => {
      await app.createProject(name, voltage, conductorId, length, seed);
      app.renderPage();
    }, 'primary'));

  // ---- 当前走廊 ----
  const c = st.terrain.corridor;
  const infoCard = el('div', { class: 'card' }, el('h2', {}, `当前走廊：${p.name}`));
  infoCard.append(table(['要素', '位置/规模'], [
    ['走廊长度', `${c.length} m`],
    ['河流', `里程 ${c.river.station.toFixed(0)} m，宽 ${c.river.width.toFixed(0)} m`],
    ['公路', `里程 ${c.road.station.toFixed(0)} m，宽 ${c.road.width} m`],
    ['低压线', `里程 ${c.lvLine.station.toFixed(0)} m，杆高 ${c.lvLine.poleHeight} m`],
    ['树林', `${c.trees.length} 棵`],
  ]));
  infoCard.append(button('换个地形重新生成', () => {
    app.mutate(() => {
      const seed = Math.floor(Math.random() * 1e6);
      p.terrainSeed = seed;
      st.terrain = generateTerrain(seed, p.corridorLength);
    });
    app.renderPage();
  }));

  // ---- 耐张段 ----
  const secCard = el('div', { class: 'card' }, el('h2', {}, '耐张段'));
  if (st.sections.length) {
    secCard.append(table(['耐张段', '档数', '代表档距(m)', '起止里程'],
      st.sections.map((s, i) => {
        const ts = st.sortedTowers();
        const first = ts.find(t => t.id === s.towerIds[0])!;
        const last = ts.find(t => t.id === s.towerIds[s.towerIds.length - 1])!;
        return [`#${i + 1}`, s.spanIds.length, s.repSpan.toFixed(1),
          `${first.station.toFixed(0)} ~ ${last.station.toFixed(0)}`];
      })));
  } else {
    secCard.append(el('p', { class: 'muted' }, '尚未排位，请到「杆塔排位」页布塔。'));
  }

  root.append(listCard, createCard, infoCard, secCard);
}
