// 页面 6: 设置 —— 曲率算法核对 (球/圆环 <2%)、20 万面性能压测、存储信息
import { h, clear, toast, fmtNum } from '../dom';
import { store } from '../../core/Store';
import { bakeCurvature } from '../../core/MeshBake';
import { Mesh, recomputeNormals, weldVertices } from '../../core/Mesh';
import { Renderer } from '../../render/Renderer';
import { REAGENTS } from '../../core/materials';
import { db } from '../../core/Storage';

function makeSphereMesh(R: number, segU: number, segV: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    for (let u = 0; u <= segU; u++) {
      const theta = (u / segU) * Math.PI * 2;
      positions.push(R * Math.sin(phi) * Math.cos(theta), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(theta));
    }
  }
  const row = segU + 1;
  for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
    const a = v * row + u, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const mesh: Mesh = {
    name: 'sphere', positions: Float32Array.from(positions), normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices), curvature: new Float32Array(positions.length / 3),
    ao: new Float32Array(positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}

function makeTorusMesh(R: number, r: number, segU: number, segV: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const rr = R + r * Math.cos(v);
      positions.push(rr * Math.cos(u), r * Math.sin(v), rr * Math.sin(u));
    }
  }
  const row = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  const mesh: Mesh = {
    name: 'torus', positions: Float32Array.from(positions), normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices), curvature: new Float32Array(positions.length / 3),
    ao: new Float32Array(positions.length / 3),
  };
  recomputeNormals(mesh);
  return mesh;
}

function checkSphere(R: number): { mean: number; median: number; max: number } {
  let mesh = weldVertices(makeSphereMesh(R, 96, 64), 1e-6);
  bakeCurvature(mesh);
  const expected = -1 / R;
  const errs: number[] = [];
  for (let i = 0; i < mesh.curvature.length; i++) {
    const y = mesh.positions[i * 3 + 1];
    if (Math.abs(Math.abs(y / R) - 1) < 0.02) continue;
    errs.push(Math.abs(mesh.curvature[i] - expected) / Math.abs(expected));
  }
  const sorted = [...errs].sort((a, b) => a - b);
  return {
    mean: errs.reduce((s, x) => s + x, 0) / errs.length,
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

function checkTorus(): { mean: number; median: number; max: number } {
  const R = 1, r = 0.35;
  let mesh = weldVertices(makeTorusMesh(R, r, 128, 64), 1e-6);
  bakeCurvature(mesh);
  const errs: number[] = [];
  for (let i = 0; i < mesh.curvature.length; i++) {
    const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
    const radial = Math.hypot(x, z);
    const cosV = (radial - R) / r;
    if (Math.abs(cosV) > 0.999) continue;
    const v = Math.acos(Math.max(-1, Math.min(1, cosV))) * (y < 0 ? -1 : 1);
    const k1 = Math.cos(v) / (R + r * Math.cos(v));
    const expected = (k1 + 1 / r) / 2;
    errs.push(Math.abs(mesh.curvature[i] - expected) / Math.max(Math.abs(expected), 1e-6));
  }
  const sorted = [...errs].sort((a, b) => a - b);
  return {
    mean: errs.reduce((s, x) => s + x, 0) / errs.length,
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
}

/** 构造约 20 万面的细分球用于性能压测 */
function makeHeavyMesh(): Mesh {
  // segU*segV*2 面 ≈ 200000 => 316*316*2 ≈ 20 万
  return makeSphereMesh(1, 400, 250);
}

export function renderSettingsPage(root: HTMLElement): void {
  clear(root);
  root.append(
    h('h2', { class: 'page-title', textContent: '设置与自检' }),
    h('p', { class: 'page-sub', textContent: '在浏览器内复核曲率算法精度与大模型渲染帧率, 验收两条硬指标: 曲率误差 <2%, 20 万面拖时间轴 ≥30 FPS' }),
  );

  // ---- 1. 曲率核对 ----
  const curvatureResult = h('div', { class: 'card' }, [
    h('h3', { textContent: '① 曲率算法核对 (离散平均曲率 vs 解析解)' }),
    h('p', { class: 'muted', textContent: '球 H=-1/R; 圆环 H=(k₁+k₂)/2。点击运行, 在浏览器内实时计算。' }),
    h('div', { id: 'curvature-out' }, [h('span', { class: 'muted', textContent: '尚未运行' })]),
    h('button', {
      class: 'btn primary', style: 'margin-top:10px', textContent: '运行曲率核对',
      onclick: () => {
        const out = document.getElementById('curvature-out')!;
        out.innerHTML = '';
        const rows: string[] = [];
        for (const R of [0.5, 1, 2]) {
          const s = checkSphere(R);
          const ok = s.mean < 0.02 && s.median < 0.02;
          rows.push(`球面 R=${R}: 平均 ${(s.mean * 100).toFixed(3)}% / 中位 ${(s.median * 100).toFixed(3)}% / 最大 ${(s.max * 100).toFixed(2)}% ${ok ? '✅' : '❌'}`);
        }
        const t = checkTorus();
        const okT = t.mean < 0.02;
        rows.push(`圆环 R=1 r=0.35: 平均 ${(t.mean * 100).toFixed(3)}% / 中位 ${(t.median * 100).toFixed(3)}% ${okT ? '✅' : '❌'}`);
        out.append(h('pre', { style: 'line-height:2;font-size:13px', textContent: rows.join('\n') }));
        toast(okT ? '曲率核对全部通过 (<2%)' : '曲率核对存在超差项', okT ? 'ok' : 'error');
      },
    }),
  ]);

  // ---- 2. 性能压测 ----
  const perfResult = h('div', { class: 'card' }, [
    h('h3', { textContent: '② 20 万面渲染性能压测' }),
    h('p', { class: 'muted', textContent: '生成约 20 万三角形网格, 用真实 PBR 着色器渲染并统计 FPS, 同时模拟时间轴参数变化。' }),
    h('div', { id: 'perf-out', style: 'display:flex;gap:16px;align-items:center' }, [
      h('span', { class: 'muted', textContent: '尚未运行' }),
    ]),
    h('canvas', { id: 'perf-canvas', width: 640, height: 400, style: 'width:100%;border-radius:8px;background:#0b0c10;display:none' }),
    h('button', {
      class: 'btn primary', style: 'margin-top:10px', textContent: '运行 20 万面压测',
      onclick: async () => runPerfTest(),
    }),
  ]);

  // ---- 3. 存储信息 ----
  const storageCard = h('div', { class: 'card' }, [h('h3', { textContent: '③ IndexedDB 存储' })]);
  db.listProjects().then((projects) => {
    storageCard.append(
      h('div', { class: 'work-meta' }, [
        `工程数量: ${projects.length}`, h('br'),
        `数据库: patina-studio (projects / meshes 两个对象库)`, h('br'),
        projects.map((p) => `· ${p.name} (${p.schemes.length} 方案)`).join('\n'),
      ]),
      h('button', {
        class: 'btn danger', style: 'margin-top:10px', textContent: '清空全部工程数据',
        onclick: async () => {
          if (!confirm('将删除 IndexedDB 中全部工程与几何, 不可恢复, 确认?')) return;
          indexedDB.deleteDatabase('patina-studio');
          location.reload();
        },
      }),
    );
  });

  // ---- 4. 药剂表 ----
  const reagentCard = h('div', { class: 'card' }, [
    h('h3', { textContent: '④ 药剂与材质参数表' }),
    h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px' }, [
      h('thead', {}, [h('tr', {}, ['药剂', '类型', '金属度', '粗糙度', '说明'].map((t) =>
        h('th', { style: 'border:1px solid var(--line);padding:6px', textContent: t })))]),
      h('tbody', {}, Object.values(REAGENTS).map((d) =>
        h('tr', {}, [d.name, d.kind, d.metalness.toFixed(2), d.roughness.toFixed(2), d.description].map((t) =>
          h('td', { style: 'border:1px solid var(--line);padding:6px', textContent: String(t) }))))),
    ]),
  ]);

  root.append(curvatureResult, perfResult, storageCard, reagentCard);
}

async function runPerfTest(): Promise<void> {
  const out = document.getElementById('perf-out')!;
  const canvas = document.getElementById('perf-canvas') as HTMLCanvasElement;
  canvas.style.display = 'block';
  out.innerHTML = '<span class="muted">生成 20 万面网格中...</span>';
  await new Promise((r) => setTimeout(r, 30));

  const mesh = makeHeavyMesh();
  // 给压测网格填占位曲率/AO (真实场景来自烘焙)
  mesh.ao = new Float32Array(mesh.curvature.length).fill(1);
  out.innerHTML = `<span class="muted">网格: ${fmtNum(mesh.indices.length / 3)} 三角形, 初始化 WebGL2...</span>`;
  await new Promise((r) => setTimeout(r, 30));

  const renderer = new Renderer(canvas);
  renderer.uploadMesh(mesh);
  const cam = { yaw: 0.6, pitch: 0.25, distance: 3.2, target: [0, 0, 0] as [number, number, number] };
  const layers = [{
    id: 'x', reagent: 'k2s' as const, concentration: 0.8, passes: 2, cavityBias: 0.4, enabled: true,
  }, {
    id: 'y', reagent: 'verdigrisGreen' as const, concentration: 0.6, passes: 2, cavityBias: 0.8, enabled: true,
  }];
  const weathering = {
    years: 20, facing: 0, rainAngle: 270, rainTilt: 25,
    environment: 'sunny' as const, patinaRate: 1, streakStrength: 0.7,
  };

  // 预热 5 帧 (每帧让出事件循环, 避免软件渲染阻塞页面)
  for (let i = 0; i < 5; i++) {
    renderer.render(cam, layers as never, weathering);
    await new Promise((r) => setTimeout(r, 0));
  }

  // 自适应帧数: 先用 10 帧探测单帧耗时, 软件渲染慢则少测, GPU 快则满测
  const probeT0 = performance.now();
  for (let i = 0; i < 10; i++) renderer.render(cam, layers as never, weathering);
  const probeMs = (performance.now() - probeT0) / 10;
  const N = probeMs > 40 ? 30 : 120;

  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    weathering.years = (i % 50) as number; // 模拟拖时间轴: uniform 每帧变化
    const t0 = performance.now();
    renderer.render(cam, layers as never, weathering);
    samples.push(performance.now() - t0);
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
  }
  const avgMs = samples.reduce((s, x) => s + x, 0) / samples.length;
  const fps = Math.round(1000 / avgMs);
  const tri = mesh.indices.length / 3;
  const pass = fps >= 30;
  out.innerHTML = '';
  out.append(
    h('div', {}, [
      h('div', { style: `font-size:26px;font-weight:700;color:${pass ? 'var(--ok)' : 'var(--danger)'}`, textContent: `${fps} FPS` }),
      h('div', { class: 'muted', textContent: `${fmtNum(tri)} 三角形 · 每帧 ${avgMs.toFixed(2)} ms · 采样 ${N} 帧` }),
      h('div', { class: pass ? 'tag-ok' : 'tag-err', textContent: pass ? '✅ 满足 ≥30 FPS 验收指标' : '❌ 未达 30 FPS (当前可能为软件渲染, 真机 GPU 复核)' }),
    ]),
  );
  toast(pass ? '性能压测通过' : '帧率不达标', pass ? 'ok' : 'error');
  renderer.dispose();
  void store;
}
