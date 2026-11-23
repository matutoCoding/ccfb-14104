// 页面 2: 模型导入 —— OBJ/glTF 解析、自动减面、程序化胸像、几何烘焙
import { h, clear, toast, fmtNum } from '../dom';
import { store } from '../../core/Store';
import { Mesh, weldVertices, triangleCount, vertexCount } from '../../core/Mesh';
import { parseOBJ } from '../../core/ObjLoader';
import { parseGLB, parseGLTF } from '../../core/GltfLoader';
import { decimate } from '../../core/Decimate';
import { generateBust } from '../../core/BustGenerator';
import { bakeMesh } from '../../core/MeshBake';
import { normalizeMeshToUnit } from '../../math/vecmath';
import { ViewPanel } from '../ViewPanel';
import { makeDefaultLayers, DEFAULT_WEATHERING } from '../../core/materials';

const AUTO_DECIMATE_THRESHOLD = 100000; // 超过 10 万面自动减面
const DEFAULT_TARGET = 80000;

let stagedMesh: Mesh | null = null;
let stagedSource: 'procedural' | 'obj' | 'gltf' = 'procedural';
let stagedFileName = '';
let preview: ViewPanel | null = null;

export function renderImportPage(root: HTMLElement): void {
  clear(root);
  stagedMesh = null;
  root.append(
    h('h2', { class: 'page-title', textContent: '模型导入' }),
    h('p', { class: 'page-sub', textContent: '支持 OBJ 与 glTF/GLB; 无模型时可生成带衣褶和浮雕底座的程序化胸像。导入后自动焊接、归一化并烘焙曲率/环境遮蔽。' }),
  );

  const viewWrap = h('div', { class: 'view-wrap', style: 'min-height:380px' });
  const side = h('div', { class: 'side-panel' });
  root.append(h('div', { class: 'workspace' }, [viewWrap, side]));

  // ---- 左侧: 占位提示, 导入后挂预览 ----
  viewWrap.append(h('div', {
    class: 'empty-hint',
    textContent: '从右侧选择模型文件, 或直接生成程序化胸像',
    style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
  }));

  const progressBox = h('div', { style: 'display:none' });
  const showProgress = (text: string, ratio: number) => {
    progressBox.style.display = 'block';
    progressBox.innerHTML = '';
    progressBox.append(
      h('div', { class: 'progress-text', textContent: text }),
      h('div', { class: 'progress' }, [h('div', { style: `width:${Math.round(ratio * 100)}%` })]),
    );
  };

  const meshInfo = h('div', { class: 'card' });
  const refreshInfo = () => {
    meshInfo.innerHTML = '';
    if (!stagedMesh) {
      meshInfo.append(h('div', { class: 'muted', textContent: '尚未载入几何' }));
      return;
    }
    meshInfo.append(
      h('h3', { textContent: '几何信息' }),
      h('div', { class: 'work-meta' }, [
        `顶点: ${fmtNum(vertexCount(stagedMesh))}`, h('br'),
        `三角形: ${fmtNum(triangleCount(stagedMesh))}`, h('br'),
        `曲率范围: ${fmtNum(Math.min(...stagedMesh.curvature), 2)} ~ ${fmtNum(Math.max(...stagedMesh.curvature), 2)}`, h('br'),
        `AO 均值: ${(stagedMesh.ao.reduce((s, x) => s + x, 0) / stagedMesh.ao.length).toFixed(3)}`,
      ]),
    );
  };
  refreshInfo();

  const mountPreview = () => {
    preview?.dispose();
    viewWrap.innerHTML = '';
    if (!stagedMesh) return;
    preview = new ViewPanel(
      viewWrap,
      stagedMesh,
      () => makeDefaultLayers(),
      () => ({ ...DEFAULT_WEATHERING }),
    );
  };

  const nameInput = h('input', { type: 'text', value: `铜雕作品 ${new Date().toLocaleDateString('zh-CN')}` });
  const decimateInput = h('input', { type: 'number', value: String(DEFAULT_TARGET), min: '1000', step: '1000' });
  const rayInput = h('input', { type: 'number', value: '12', min: '4', max: '32', step: '2' });

  // ---- 文件选择 ----
  const fileInput = h('input', {
    type: 'file', accept: '.obj,.gltf,.glb,.bin', style: 'display:none',
    onchange: async (e: Event) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length === 0) return;
      const main = files.find((f) => /\.(obj|gltf|glb)$/i.test(f.name));
      if (!main) { toast('请选择 .obj / .gltf / .glb 文件', 'error'); return; }
      try {
        let mesh: Mesh;
        if (/\.obj$/i.test(main.name)) {
          mesh = parseOBJ(await main.text(), main.name);
          stagedSource = 'obj';
        } else if (/\.glb$/i.test(main.name)) {
          mesh = await parseGLB(await main.arrayBuffer(), main.name);
          stagedSource = 'gltf';
        } else {
          const resources = { files: new Map<string, ArrayBuffer>() };
          for (const f of files) resources.files.set(f.name, await f.arrayBuffer());
          mesh = await parseGLTF(await main.text(), resources, main.name);
          stagedSource = 'gltf';
        }
        stagedFileName = main.name;
        await prepareMesh(mesh, true);
      } catch (err) {
        toast('解析失败: ' + (err as Error).message, 'error');
      }
      fileInput.value = '';
    },
  });

  const prepareMesh = async (raw: Mesh, allowDecimate: boolean) => {
    let mesh = weldVertices(raw, 1e-6);
    normalizeMeshToUnit(mesh.positions);
    const tri = triangleCount(mesh);
    if (allowDecimate && tri > AUTO_DECIMATE_THRESHOLD) {
      const target = Math.min(Number(decimateInput.value) || DEFAULT_TARGET, tri - 1);
      showProgress(`自动减面中: ${fmtNum(tri)} → ${fmtNum(target)} 面 (QEM 边坍缩)`, 0.1);
      await new Promise((r) => setTimeout(r, 30));
      mesh = decimate(mesh, target, (p) => showProgress(
        `自动减面中 ${Math.round(p.ratio * 100)}% (已移除 ${fmtNum(p.removed)} 面)`, 0.1 + p.ratio * 0.4));
    }
    showProgress('烘焙曲率与环境遮蔽 (光线投射)...', 0.55);
    await bakeMesh(mesh, Number(rayInput.value) || 12, 0.6, (p) =>
      showProgress(p.phase === 'curvature' ? '计算离散平均曲率 (Meyer 余切公式)...' : `环境遮蔽光线投射 ${Math.round(p.ratio * 100)}%`, p.ratio));
    progressBox.style.display = 'none';
    stagedMesh = mesh;
    refreshInfo();
    mountPreview();
    toast(`几何就绪: ${fmtNum(vertexCount(mesh))} 顶点 / ${fmtNum(triangleCount(mesh))} 面`, 'ok');
  };

  side.append(
    h('div', { class: 'card' }, [
      h('h3', { textContent: '1. 选择几何来源' }),
      h('button', { class: 'btn primary', style: 'width:100%;margin-bottom:8px', textContent: '生成程序化胸像 (衣褶+浮雕底座)', onclick: async () => {
        showProgress('生成参数化胸像曲面...', 0.1);
        await new Promise((r) => setTimeout(r, 30));
        const mesh = generateBust();
        normalizeMeshToUnit(mesh.positions);
        stagedSource = 'procedural';
        stagedFileName = '';
        await prepareMesh(mesh, false);
      } }),
      h('button', { class: 'btn', style: 'width:100%', textContent: '导入 OBJ / glTF / GLB', onclick: () => fileInput.click() }),
      fileInput,
      h('p', { class: 'muted', style: 'font-size:12px;margin-top:8px', textContent: `.gltf 外链 .bin 时请一并选中; 超过 10 万面将自动减面` }),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { textContent: '2. 处理参数' }),
      h('label', { class: 'field' }, [h('span', { textContent: '作品名称' }), nameInput]),
      h('label', { class: 'field' }, [h('span', { textContent: '减面目标面数 (超 10 万面时生效)' }), decimateInput]),
      h('label', { class: 'field' }, [h('span', { textContent: 'AO 每顶点光线数 (4~32)' }), rayInput]),
    ]),
    progressBox,
    meshInfo,
    h('div', { class: 'card' }, [
      h('h3', { textContent: '3. 创建工程' }),
      h('button', {
        class: 'btn primary', style: 'width:100%', textContent: '创建并进入着色工序',
        onclick: async () => {
          if (!stagedMesh) { toast('请先生成或导入模型', 'error'); return; }
          const id = await store.createProject(nameInput.value || '未命名铜雕', stagedMesh!, stagedSource, stagedFileName || undefined);
          await store.openProject(id);
          toast('工程已保存到 IndexedDB', 'ok');
          store.goto('process');
        },
      }),
    ]),
  );
}

export function disposeImportPreview(): void {
  preview?.dispose();
  preview = null;
}
