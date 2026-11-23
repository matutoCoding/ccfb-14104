// 应用入口: 顶栏路由 + 页面挂载/卸载
import './styles.css';
import { h } from './ui/dom';
import { store } from './core/Store';
import { renderWorksPage } from './ui/pages/works';
import { renderImportPage, disposeImportPreview } from './ui/pages/import';
import { renderProcessPage, disposeProcessPanel } from './ui/pages/process';
import { renderWeatheringPage, disposeWeatheringPanel } from './ui/pages/weathering';
import { renderComparePage, disposeComparePanels } from './ui/pages/compare';
import { renderSettingsPage } from './ui/pages/settings';

const NAV: { id: typeof store.page; label: string; needProject?: boolean }[] = [
  { id: 'works', label: '作品列表' },
  { id: 'import', label: '模型导入' },
  { id: 'process', label: '着色工序', needProject: true },
  { id: 'weathering', label: '风化推演', needProject: true },
  { id: 'compare', label: '方案对比', needProject: true },
  { id: 'settings', label: '设置' },
];

const pageRoot = document.getElementById('page-root')!;
const topbar = document.getElementById('nav-root')!;

function disposeCurrent(): void {
  disposeImportPreview();
  disposeProcessPanel();
  disposeWeatheringPanel();
  disposeComparePanels();
}

function render(): void {
  // 顶栏
  topbar.innerHTML = '';
  topbar.append(h('div', { class: 'brand', textContent: '铜雕着色风化推演' }));
  for (const n of NAV) {
    const disabled = n.needProject && !store.current;
    topbar.append(h('button', {
      class: 'nav-btn' + (store.page === n.id ? ' active' : ''),
      textContent: n.label,
      disabled,
      title: disabled ? '请先打开工程' : '',
      onclick: () => {
        if (n.needProject && !store.current) return;
        disposeCurrent();
        store.goto(n.id);
      },
    }));
  }
  topbar.append(h('div', { class: 'spacer' }));
  if (store.current) {
    topbar.append(
      h('span', { class: 'project-chip' }, [
        store.current.project.name,
        store.current.dirty ? h('span', { class: 'dirty-dot', textContent: ' ●未保存' }) : '',
      ]),
      h('button', {
        class: 'btn small', style: 'margin-left:12px', textContent: '保存',
        onclick: async () => { await store.saveCurrent(); },
      }),
      h('button', {
        class: 'btn small', textContent: '关闭工程',
        onclick: () => { disposeCurrent(); store.closeProject(); },
      }),
    );
  }

  // 页面
  disposeCurrent();
  pageRoot.innerHTML = '';
  const page = h('div', { class: 'page' });
  pageRoot.append(page);
  switch (store.page) {
    case 'works': renderWorksPage(page); break;
    case 'import': renderImportPage(page); break;
    case 'process': renderProcessPage(page); break;
    case 'weathering': renderWeatheringPage(page); break;
    case 'compare': renderComparePage(page); break;
    case 'settings': renderSettingsPage(page); break;
  }
}

store.subscribe(render);
store.loadList().then(render).catch((err) => {
  pageRoot.append(h('div', { class: 'empty-hint tag-err', textContent: '初始化失败: ' + err.message }));
});

// 离开页面前提示未保存
window.addEventListener('beforeunload', (e) => {
  if (store.current?.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
