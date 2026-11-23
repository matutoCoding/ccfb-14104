// 页面 5: 方案对比 —— 左右分屏, 两套方案各自独立参数, 镜头双向同步
import { h, clear, toast } from '../dom';
import { store } from '../../core/Store';
import { ViewPanel } from '../ViewPanel';

let panels: ViewPanel[] = [];

export function renderComparePage(root: HTMLElement): void {
  clear(root);
  panels.forEach((p) => p.dispose());
  panels = [];
  const open = store.current;
  if (!open) { root.append(h('div', { class: 'empty-hint', textContent: '请先从作品列表打开工程' })); return; }
  const schemes = open.project.schemes;
  if (schemes.length < 2) {
    root.append(h('div', { class: 'empty-hint', textContent: '需要至少 2 个方案才能对比, 请先在「着色工序」页另存新方案' }));
    return;
  }

  let leftId = open.project.schemes[0].id;
  let rightId = open.project.schemes[1]?.id ?? schemes[0].id;

  root.append(
    h('h2', { class: 'page-title', textContent: '方案对比' }),
    h('p', { class: 'page-sub', textContent: '左右分屏实时渲染两套方案, 拖动任一视角, 另一侧镜头同步运动' }),
  );

  const wrap = h('div', { class: 'compare-wrap' });
  root.append(wrap);

  const makeCol = (side: 'left' | 'right', initialId: string) => {
    const col = h('div', { class: 'compare-col' });
    const select = h('select', {
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        if (side === 'left') leftId = id; else rightId = id;
        rebuild();
      },
    }, schemes.map((s) => h('option', { value: s.id, textContent: s.name, selected: s.id === initialId })));
    const viewWrap = h('div', { class: 'view-wrap', style: 'min-height:420px' });
    col.append(h('div', { class: 'row' }, [select]), viewWrap);
    wrap.append(col);
    return { col, viewWrap };
  };

  const rebuild = () => {
    panels.forEach((p) => p.dispose());
    panels = [];
    wrap.innerHTML = '';
    const l = makeCol('left', leftId);
    const r = makeCol('right', rightId);
    const sL = schemes.find((s) => s.id === leftId)!;
    const sR = schemes.find((s) => s.id === rightId)!;
    const pL = new ViewPanel(l.viewWrap, open.mesh, () => sL.layers, () => sL.weathering);
    const pR = new ViewPanel(r.viewWrap, open.mesh, () => sR.layers, () => sR.weathering);
    // 双向镜头同步
    pL.syncWith(pR);
    panels = [pL, pR];
    const info = h('div', { class: 'card' }, [
      h('div', { class: 'work-meta' }, [
        `左: ${sL.name} · ${sL.layers.filter((x) => x.enabled).length} 道工序 · 第 ${sL.weathering.years} 年`,
        h('br'),
        `右: ${sR.name} · ${sR.layers.filter((x) => x.enabled).length} 道工序 · 第 ${sR.weathering.years} 年`,
      ]),
      h('button', {
        class: 'btn small', style: 'margin-top:8px', textContent: '分别导出两侧 PNG',
        onclick: () => {
          for (const [p, name] of [[pL, sL.name], [pR, sR.name]] as [ViewPanel, string][]) {
            const url = p.renderer.readPixelsPNG(2, () => p.renderOnce());
            const a = h('a', { href: url, download: `${open.project.name}_对比_${name}.png` }) as HTMLAnchorElement;
            a.click();
          }
          toast('两张对比 PNG 已导出', 'ok');
        },
      }),
    ]);
    root.append(info);
  };
  rebuild();
}

export function disposeComparePanels(): void {
  panels.forEach((p) => p.dispose());
  panels = [];
}
