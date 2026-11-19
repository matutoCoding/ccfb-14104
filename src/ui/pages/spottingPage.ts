import { el, field, numberInput, select, button, table } from '../dom';
import { TOWER_LIBRARY } from '../../data/libraries';
import { autoSpot } from '../../model/autoSpot';
import { ProfileView } from '../profile';
import { newId } from '../../model/store';
import type { App } from '../app';

export function renderSpottingPage(root: HTMLElement, app: App): () => void {
  const st = app.store;
  const p = st.project;
  const types = TOWER_LIBRARY.filter(t => t.voltageKv === p.voltageKv);
  const suspTypes = types.filter(t => t.kind === 'suspension');
  const strainTypes = types.filter(t => t.kind !== 'suspension');

  let addTypeId = suspTypes[0]?.id ?? types[0].id;
  let addMode = false;
  let autoTypeId = suspTypes[0]?.id ?? types[0].id;
  let autoStrainId = strainTypes[0]?.id ?? types[0].id;
  let autoHeight = suspTypes[0]?.defaultHeight ?? 24;
  let maxSpan = suspTypes[0]?.maxSpan ?? 500;
  let margin = 1.0;

  // ---- 工具栏 ----
  const addBtn = button('点击断面放塔', () => {
    addMode = !addMode;
    addBtn.classList.toggle('primary', addMode);
    addBtn.textContent = addMode ? '在断面上点击放塔…' : '点击断面放塔';
  });
  const toolbar = el('div', { class: 'toolbar' },
    field('塔型', select(types.map(t => [t.id, `${t.name}`] as [string, string]), addTypeId,
      v => addTypeId = v)),
    addBtn,
    el('span', { class: 'sep' }, ''),
    field('自动排位塔型', select(suspTypes.map(t => [t.id, t.name] as [string, string]), autoTypeId,
      v => { autoTypeId = v; const t = suspTypes.find(x => x.id === v)!; autoHeight = t.defaultHeight; maxSpan = t.maxSpan; })),
    field('耐张塔型', select(strainTypes.map(t => [t.id, t.name] as [string, string]), autoStrainId,
      v => autoStrainId = v)),
    field('呼高(m)', numberInput(autoHeight, v => autoHeight = v)),
    field('最大档距(m)', numberInput(maxSpan, v => maxSpan = v, 10)),
    field('裕度(m)', numberInput(margin, v => margin = v, 0.5)),
    button('一键自动排位', () => {
      app.mutate(() => {
        st.towers = autoSpot(st, {
          typeId: autoTypeId, height: autoHeight, maxSpan, minSpan: 150,
          margin, strainTypeId: autoStrainId,
        });
      });
      rerenderTable();
    }, 'primary'));

  // ---- 纵断面 ----
  const profileBox = el('div', { class: 'profile-box' });
  const profile = new ProfileView(profileBox, st);
  profile.onStationClick = station => {
    if (addMode) {
      const type = TOWER_LIBRARY.find(t => t.id === addTypeId)!;
      app.mutate(() => {
        st.towers.push({
          id: newId('t'), projectId: p.id, station,
          typeId: type.id, height: type.defaultHeight, insulatorLength: type.insulatorLength,
        });
      });
      rerenderTable();
    } else {
      app.focus3d(station);
    }
  };
  profile.onTowerDragged = () => { app.persist(); rerenderTable(); };
  profile.draw();

  // ---- 杆塔表 ----
  const tableBox = el('div', { class: 'card grow' });
  function rerenderTable() {
    tableBox.innerHTML = '';
    tableBox.append(el('h2', {}, `杆塔明细（${st.towers.length} 基）—— 在断面上拖动杆塔可调整位置`));
    const ts = st.sortedTowers();
    tableBox.append(table(
      ['#', '塔型', '类型', '呼高(m)', '串长(m)', '里程(m)', '前档(m)', '后档(m)', '操作'],
      ts.map((t, i) => {
        const type = st.towerType(t);
        const prev = st.spans.find(s => s.rightTowerId === t.id)?.l;
        const next = st.spans.find(s => s.leftTowerId === t.id)?.l;
        return [
          i + 1, type.name,
          type.kind === 'suspension' ? '直线' : type.kind === 'angle' ? '转角' : '耐张',
          numberInput(t.height, v => app.mutate(() => t.height = v), 1),
          numberInput(t.insulatorLength, v => app.mutate(() => t.insulatorLength = v), 0.1),
          numberInput(t.station, v => app.mutate(() => t.station = v), 1),
          prev?.toFixed(0) ?? '-', next?.toFixed(0) ?? '-',
          button('删除', () => {
            app.mutate(() => { st.towers = st.towers.filter(x => x.id !== t.id); });
            rerenderTable();
          }, 'danger'),
        ];
      })));
  }
  rerenderTable();

  root.append(toolbar, profileBox, tableBox);
  return () => profile.dispose();
}
