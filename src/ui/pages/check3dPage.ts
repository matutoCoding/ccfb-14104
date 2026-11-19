import { el, field, select, button, table } from '../dom';
import { Scene3D } from '../../three/scene3d';
import type { App } from '../app';

export function renderCheck3dPage(root: HTMLElement, app: App): () => void {
  const st = app.store;

  // ---- 控制条 ----
  const yawInput = el('input', { type: 'range', min: '30', max: '90', step: '5',
    value: String(st.windYawDeg) });
  const yawLabel = el('span', {}, `${st.windYawDeg}°`);
  yawInput.addEventListener('input', () => {
    st.windYawDeg = Number(yawInput.value);
    yawLabel.textContent = `${st.windYawDeg}°`;
    st.recompute();
  });
  const toggleBtn = button('显示全部校核线', () => {
    if (!app.scene3d) return;
    app.scene3d.showAllClearanceLines = !app.scene3d.showAllClearanceLines;
    toggleBtn.textContent = app.scene3d.showAllClearanceLines ? '只看不满足/预警' : '显示全部校核线';
    st.refreshClearances();
  });
  const toolbar = el('div', { class: 'toolbar' },
    field('工况', select(st.project.loadCases.map(lc => [lc.id, lc.name] as [string, string]),
      st.activeCaseId, v => { st.activeCaseId = v; st.recompute(); })),
    field('风向与线路夹角', yawInput), yawLabel,
    toggleBtn,
    el('span', { class: 'muted' }, '拖动杆塔可沿线路移动；点击右侧校核项定位'));

  // ---- 三维视图 ----
  const viewBox = el('div', { class: 'view3d-box' });
  const scene = new Scene3D(viewBox);
  app.scene3d = scene;
  scene.setStore(st);
  scene.onTowerDragged = () => app.persist();
  if (app.pendingFocusStation != null) {
    scene.focusStation(app.pendingFocusStation, 400);
    app.pendingFocusStation = null;
  }

  // ---- 校核结果列表 ----
  const sideBox = el('div', { class: 'card side' });
  const renderIssues = () => {
    sideBox.innerHTML = '';
    const fails = st.clearances.filter(r => !r.pass);
    const warns = st.clearances.filter(r => r.pass && (r.value - r.required) / r.required < 0.15);
    sideBox.append(el('h2', {},
      fails.length ? `⚠ ${fails.length} 处不满足` : '✓ 全部满足',
      ));
    sideBox.firstElementChild!.className = fails.length ? 'bad' : 'ok';
    const rows = [...fails, ...warns].map(r => {
      const tr = el('tr', { class: r.pass ? 'warn' : 'fail' },
        el('td', {}, r.kindLabel),
        el('td', {}, `${r.station.toFixed(0)}m`),
        el('td', {}, r.value.toFixed(2)),
        el('td', {}, r.required.toFixed(1)),
        el('td', {}, (r.value - r.required).toFixed(2)));
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => scene.focusStation(r.station, 300));
      return tr;
    });
    if (rows.length) {
      const t = el('table', { class: 'data' });
      const head = el('thead');
      head.append(el('tr', {}, ...['对象', '里程', '实测', '要求', '裕度'].map(h => el('th', {}, h))));
      t.append(head, el('tbody', {}, ...rows));
      sideBox.append(t);
    } else {
      sideBox.append(el('p', { class: 'muted' }, '当前工况下无预警项'));
    }
  };
  renderIssues();
  const unsub = st.onChange(renderIssues);

  const layout = el('div', { class: 'check3d-layout' }, viewBox, sideBox);
  root.append(toolbar, layout);
  return () => { unsub(); scene.dispose(); };
}
