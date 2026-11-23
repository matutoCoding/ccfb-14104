// 页面 1: 作品列表 —— 增删改复制、工程打包导入导出
import { h, clear, toast, fmtNum } from '../dom';
import { store } from '../../core/Store';
import { db } from '../../core/Storage';
import { buildPackage, maybeCompress, maybeDecompress, parsePackage, downloadBlob } from '../../core/Package';
import { makeId } from '../../core/materials';

export function renderWorksPage(root: HTMLElement): void {
  clear(root);
  const list = store.projects;
  root.append(
    h('div', {}, [
      h('h2', { class: 'page-title', textContent: '作品列表' }),
      h('p', { class: 'page-sub', textContent: '管理铜雕工程, 工程含几何、着色工序与风化方案, 可整体打包迁移' }),
    ]),
  );

  const toolbar = h('div', { class: 'row', style: 'justify-content:flex-end' }, [
    h('button', {
      class: 'btn', textContent: '导入工程包 (.patina)',
      onclick: () => importInput.click(),
    }),
    h('button', {
      class: 'btn primary', textContent: '+ 新建作品',
      onclick: () => store.goto('import'),
    }),
  ]);
  const importInput = h('input', {
    type: 'file', accept: '.patina,.patina.gz', style: 'display:none',
    onchange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raw = await maybeDecompress(file);
        const payload = parsePackage(raw);
        // 重新分配 id, 避免覆盖
        const oldId = payload.project.id;
        payload.project.id = makeId('prj');
        payload.project.name += ' (导入)';
        payload.mesh.projectId = payload.project.id;
        payload.project.schemes.forEach((s) => (s.id = makeId('sch')));
        payload.project.activeSchemeId = payload.project.schemes[0].id;
        await db.putProject(payload.project);
        await db.putMesh(payload.mesh);
        void oldId;
        await store.loadList();
        toast('工程包导入成功', 'ok');
      } catch (err) {
        toast('导入失败: ' + (err as Error).message, 'error');
      }
      importInput.value = '';
    },
  });
  root.append(toolbar);

  if (list.length === 0) {
    root.append(h('div', { class: 'empty-hint', textContent: '还没有作品, 点右上角「新建作品」开始, 可导入 OBJ/glTF 或生成程序化胸像' }));
    return;
  }

  const grid = h('div', { class: 'work-grid' });
  for (const p of list) {
    const card = h('div', { class: 'work-card' }, [
      h('div', { class: 'work-name', textContent: p.name }),
      h('div', { class: 'work-meta' }, [
        `来源: ${sourceLabel(p.source)}${p.sourceFileName ? ' · ' + p.sourceFileName : ''}`,
        h('br'),
        `方案数: ${p.schemes.length} · 创建: ${new Date(p.createdAt).toLocaleDateString('zh-CN')}`,
      ]),
      h('div', { class: 'work-actions' }, [
        h('button', {
          class: 'btn primary small', textContent: '打开',
          onclick: async () => {
            await store.openProject(p.id);
            store.goto('process');
          },
        }),
        h('button', {
          class: 'btn small', textContent: '重命名',
          onclick: async () => {
            const name = prompt('作品名称', p.name);
            if (!name) return;
            p.name = name;
            p.updatedAt = Date.now();
            await db.putProject(p);
            await store.loadList();
          },
        }),
        h('button', {
          class: 'btn small', textContent: '复制',
          onclick: async () => {
            await store.duplicateProject(p.id);
            toast('已复制工程', 'ok');
          },
        }),
        h('button', {
          class: 'btn small', textContent: '导出包',
          onclick: async () => {
            try {
              const proj = await db.getProject(p.id);
              const mesh = await db.getMesh(p.id);
              if (!proj || !mesh) throw new Error('数据缺失');
              const buf = buildPackage({ project: proj, mesh });
              const { data, compressed } = await maybeCompress(buf);
              downloadBlob(data, `${p.name}.patina${compressed ? '.gz' : ''}`);
              toast(`已导出 (${fmtNum(data.size)} 字节)`, 'ok');
            } catch (err) {
              toast('导出失败: ' + (err as Error).message, 'error');
            }
          },
        }),
        h('button', {
          class: 'btn danger small', textContent: '删除',
          onclick: async () => {
            if (!confirm(`确认删除作品「${p.name}」? 几何与方案将一并删除, 不可恢复。`)) return;
            await store.deleteProject(p.id);
            toast('已删除', 'ok');
          },
        }),
      ]),
    ]);
    grid.append(card);
  }
  root.append(grid);
}

function sourceLabel(s: string): string {
  return s === 'procedural' ? '程序化胸像' : s === 'obj' ? 'OBJ 导入' : 'glTF 导入';
}
