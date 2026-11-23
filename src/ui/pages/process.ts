// 页面 3: 着色工序 —— 按工序叠层, 药剂/浓度/遍数, 拖拽调序, 实时 PBR 预览
import { h, clear, toast, fmtNum } from '../dom';
import { store } from '../../core/Store';
import { ViewPanel } from '../ViewPanel';
import { ProcessLayer, REAGENTS, ReagentId, makeId } from '../../core/materials';
import { bakeMesh } from '../../core/MeshBake';
import { triangleCount, vertexCount } from '../../core/Mesh';

let panel: ViewPanel | null = null;

export function renderProcessPage(root: HTMLElement): void {
  clear(root);
  const open = store.current;
  if (!open) { root.append(h('div', { class: 'empty-hint', textContent: '请先从作品列表打开工程' })); return; }
  const scheme = store.activeScheme!;

  root.append(
    h('h2', { class: 'page-title', textContent: '着色工序' }),
    h('p', { class: 'page-sub', textContent: '按真实施工顺序叠层: 基底 → 硫化烧黑 → 铜绿积色 → 擦亮。每层的凹处偏好由烘焙曲率与 AO 驱动, 凹处积色、凸处擦亮。' }),
  );

  const viewWrap = h('div', { class: 'view-wrap' });
  const side = h('div', { class: 'side-panel' });
  root.append(h('div', { class: 'workspace', style: 'flex:1;min-height:0' }, [viewWrap, side]));

  panel = new ViewPanel(viewWrap, open.mesh, () => scheme.layers, () => scheme.weathering);

  // 视图工具栏: 调试模式
  const toolbar = h('div', { class: 'view-toolbar' }, [
    h('button', { class: 'btn small', textContent: '材质', onclick: () => { panel!.renderer.debugMode = -1; } }),
    h('button', { class: 'btn small', textContent: '曲率图', onclick: () => { panel!.renderer.debugMode = 0; } }),
    h('button', { class: 'btn small', textContent: 'AO 图', onclick: () => { panel!.renderer.debugMode = 1; } }),
  ]);
  viewWrap.append(toolbar);

  // ---- 方案选择 ----
  const schemeSelect = h('select', {
    onchange: (e: Event) => store.setActiveScheme((e.target as HTMLSelectElement).value),
  }, open.project.schemes.map((s) => h('option', { value: s.id, textContent: s.name, selected: s.id === scheme.id })));

  const layerList = h('div', { class: 'layer-list' });

  const renderLayers = () => {
    layerList.innerHTML = '';
    scheme.layers.forEach((layer, idx) => {
      const def = REAGENTS[layer.reagent];
      const item = h('div', {
        class: 'layer-item', dataset: { id: layer.id },
      }, [
        h('div', { class: 'layer-head' }, [
          h('span', { class: 'drag-handle', textContent: '⠿' }),
          h('span', { class: 'layer-title', textContent: `${idx + 1}. ${def.name}` }),
          h('span', { class: `kind-tag ${def.kind}`, textContent: kindLabel(def.kind) }),
          h('input', {
            type: 'checkbox', checked: layer.enabled, title: '启用/停用该工序',
            onchange: (e: Event) => { layer.enabled = (e.target as HTMLInputElement).checked; store.markDirty(); },
          }),
          h('button', {
            class: 'btn danger small', textContent: '✕', title: '删除工序',
            onclick: () => {
              scheme.layers = scheme.layers.filter((l) => l.id !== layer.id);
              store.markDirty();
              renderLayers();
            },
          }),
        ]),
        h('div', { class: 'layer-controls' }, [
          h('label', {}, ['药剂', h('select', {
            onchange: (e: Event) => { layer.reagent = (e.target as HTMLSelectElement).value as ReagentId; store.markDirty(); renderLayers(); },
          }, Object.values(REAGENTS).map((r) => h('option', { value: r.id, textContent: r.name, selected: r.id === layer.reagent })))]),
          h('label', {}, [`遍数 ×${layer.passes}`, h('input', {
            type: 'range', min: '1', max: '5', step: '1', value: String(layer.passes),
            oninput: (e: Event) => { layer.passes = Number((e.target as HTMLInputElement).value); store.markDirty(); renderLayers(); },
          })]),
          h('label', {}, [`浓度 ${Math.round(layer.concentration * 100)}%`, h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: String(layer.concentration),
            oninput: (e: Event) => { layer.concentration = Number((e.target as HTMLInputElement).value); store.markDirty(); renderLayers(); },
          })]),
          h('label', {}, [`凹处偏好 ${Math.round(layer.cavityBias * 100)}%`, h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: String(layer.cavityBias),
            oninput: (e: Event) => { layer.cavityBias = Number((e.target as HTMLInputElement).value); store.markDirty(); },
          })]),
        ]),
      ]);
      item.draggable = true;
      layerList.append(item);
    });
    bindDnD();
  };

  // HTML5 拖拽排序
  let dragId: string | null = null;
  const bindDnD = () => {
    layerList.querySelectorAll('.layer-item').forEach((el) => {
      el.addEventListener('dragstart', () => {
        dragId = (el as HTMLElement).dataset.id!;
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        layerList.querySelectorAll('.layer-item').forEach((x) => x.classList.remove('over'));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetId = (el as HTMLElement).dataset.id!;
        if (!dragId || dragId === targetId) return;
        const ids = scheme.layers.map((l) => l.id);
        const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
        const [moved] = scheme.layers.splice(from, 1);
        scheme.layers.splice(to, 0, moved);
        store.markDirty();
        renderLayers();
      });
    });
  };
  renderLayers();

  side.append(
    h('div', { class: 'card' }, [
      h('h3', { textContent: '方案' }),
      schemeSelect,
      h('div', { class: 'row', style: 'margin-top:8px' }, [
        h('button', {
          class: 'btn small', textContent: '另存为新方案',
          onclick: () => {
            const s = store.addScheme('方案 ' + (open.project.schemes.length + 1));
            s.layers = structuredClone(scheme.layers);
            s.weathering = structuredClone(scheme.weathering);
            store.markDirty();
            renderProcessPage(root);
          },
        }),
        h('button', {
          class: 'btn danger small', textContent: '删除方案',
          onclick: () => { store.removeScheme(scheme.id); renderProcessPage(root); },
        }),
      ]),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { textContent: `工序叠层 (${scheme.layers.length}/8)` }),
      layerList,
      h('button', {
        class: 'btn', style: 'width:100%;margin-top:10px',
        textContent: '+ 添加工序',
        onclick: () => {
          if (scheme.layers.length >= 8) { toast('最多支持 8 个工序层', 'error'); return; }
          const layer: ProcessLayer = {
            id: makeId('lyr'), reagent: 'verdigrisGreen', concentration: 0.6, passes: 1, cavityBias: 0.7, enabled: true,
          };
          scheme.layers.push(layer);
          store.markDirty();
          renderLayers();
        },
      }),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { textContent: '几何与烘焙' }),
      h('div', { class: 'work-meta' }, [
        `顶点 ${fmtNum(vertexCount(open.mesh))} · 三角形 ${fmtNum(triangleCount(open.mesh))}`, h('br'),
        '曲率: Meyer 余切公式, 球/圆环核对误差 <2%', h('br'),
        'AO: 半球光线投射 (均匀网格加速)',
      ]),
      h('button', {
        class: 'btn small', style: 'margin-top:8px', textContent: '重新烘焙 AO',
        onclick: async () => {
          toast('重新烘焙中...', 'info');
          await bakeMesh(open.mesh, open.project.rayCount);
          panel!.renderer.uploadMesh(open.mesh);
          store.markDirty();
          toast('烘焙完成', 'ok');
        },
      }),
    ]),
    h('button', {
      class: 'btn primary', textContent: '保存工程',
      onclick: async () => { await store.saveCurrent(); toast('已保存到 IndexedDB', 'ok'); },
    }),
  );
}

function kindLabel(k: string): string {
  return k === 'base' ? '基底' : k === 'darken' ? '烧黑' : k === 'patinaGreen' ? '绿锈' : k === 'patinaBlue' ? '蓝锈' : '擦亮';
}

export function disposeProcessPanel(): void {
  panel?.dispose();
  panel = null;
}
