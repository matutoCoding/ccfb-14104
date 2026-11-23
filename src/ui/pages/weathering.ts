// 页面 4: 风化推演 —— 年份时间轴、朝向、淋雨方向、环境预设、高清 PNG 导出
import { h, clear, toast } from '../dom';
import { store } from '../../core/Store';
import { ViewPanel } from '../ViewPanel';
import { EnvironmentId } from '../../core/materials';
import { exportProcessSheet } from '../../export/sheet';

let panel: ViewPanel | null = null;

export function renderWeatheringPage(root: HTMLElement): void {
  clear(root);
  const open = store.current;
  if (!open) { root.append(h('div', { class: 'empty-hint', textContent: '请先从作品列表打开工程' })); return; }
  const scheme = store.activeScheme!;
  const w = scheme.weathering;

  root.append(
    h('h2', { class: 'page-title', textContent: '风化推演' }),
    h('p', { class: 'page-sub', textContent: '拖动时间轴实时推演 0~50 年户外风化: 朝向与淋雨方向决定铜绿着生位置, 雨痕沿竖直方向流成竖条, 凹处积水积色。' }),
  );

  const viewWrap = h('div', { class: 'view-wrap' });
  const side = h('div', { class: 'side-panel' });
  const body = h('div', { class: 'workspace', style: 'flex:1;min-height:0' }, [viewWrap, side]);
  root.append(body);

  panel = new ViewPanel(viewWrap, open.mesh, () => scheme.layers, () => w);

  // ---- 时间轴 ----
  const yearLabel = h('span', { class: 'year-mark', textContent: `第 ${w.years} 年` });
  const yearSlider = h('input', {
    type: 'range', class: 'big-range', min: '0', max: '50', step: '1', value: String(w.years),
    oninput: (e: Event) => {
      w.years = Number((e.target as HTMLInputElement).value);
      yearLabel.textContent = `第 ${w.years} 年`;
      store.markDirty();
    },
  });
  const timeline = h('div', { class: 'timeline-wrap' }, [
    h('div', { class: 'timeline-head' }, [
      h('strong', { textContent: '户外暴露时间' }),
      yearLabel,
    ]),
    yearSlider,
    h('div', { class: 'row', style: 'margin-top:6px' }, [
      h('button', { class: 'btn small', textContent: '刚完工 (0年)', onclick: () => { w.years = 0; yearSlider.value = '0'; yearLabel.textContent = '第 0 年'; } }),
      h('button', { class: 'btn small', textContent: '10 年', onclick: () => { w.years = 10; yearSlider.value = '10'; yearLabel.textContent = '第 10 年'; } }),
      h('button', { class: 'btn small', textContent: '25 年', onclick: () => { w.years = 25; yearSlider.value = '25'; yearLabel.textContent = '第 25 年'; } }),
      h('button', { class: 'btn small', textContent: '50 年', onclick: () => { w.years = 50; yearSlider.value = '50'; yearLabel.textContent = '第 50 年'; } }),
    ]),
  ]);
  body.after(timeline);

  const slider = (labelText: string, value: number, min: number, max: number, step: number, unit: string, apply: (v: number) => void) => {
    const val = h('span', { class: 'inline-val', textContent: value + unit });
    return h('label', { class: 'field' }, [
      h('span', { textContent: labelText }),
      h('div', { class: 'row' }, [
        h('input', {
          type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
          oninput: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            val.textContent = v + unit;
            apply(v);
            store.markDirty();
          },
        }),
        val,
      ]),
    ]);
  };

  const envButtons = (['sunny', 'overcast', 'night'] as EnvironmentId[]).map((env) =>
    h('button', {
      class: 'btn small' + (w.environment === env ? ' primary' : ''),
      textContent: env === 'sunny' ? '晴天' : env === 'overcast' ? '阴天' : '夜景投光',
      onclick: () => {
        w.environment = env;
        store.markDirty();
        renderWeatheringPage(root);
      },
    }));

  side.append(
    h('div', { class: 'card' }, [
      h('h3', { textContent: '环境光照' }),
      h('div', { class: 'row' }, envButtons),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { textContent: '朝向与淋雨' }),
      slider('主导朝向 (度, 铜绿偏好面)', w.facing, 0, 360, 5, '°', (v) => (w.facing = v)),
      slider('雨水来向水平角', w.rainAngle, 0, 360, 5, '°', (v) => (w.rainAngle = v)),
      slider('雨滴倾角 (0=水平雨, 90=垂直下落)', w.rainTilt, 5, 85, 1, '°', (v) => (w.rainTilt = v)),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { textContent: '风化参数' }),
      slider('铜绿生长速率 (厂区气候)', w.patinaRate, 0.2, 2, 0.1, '×', (v) => (w.patinaRate = v)),
      slider('雨痕强度', w.streakStrength, 0, 1.5, 0.05, '', (v) => (w.streakStrength = v)),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { textContent: '导出' }),
      h('button', {
        class: 'btn primary', style: 'width:100%;margin-bottom:8px', textContent: '导出当前视图高清 PNG (2×)',
        onclick: () => {
          const url = panel!.renderer.readPixelsPNG(2, () => panel!.renderOnce());
          const a = h('a', { href: url, download: `${open.project.name}_${w.years}年.png` }) as HTMLAnchorElement;
          a.click();
          toast('PNG 已导出', 'ok');
        },
      }),
      h('button', {
        class: 'btn', style: 'width:100%', textContent: '导出工序单 (车间施工用)',
        onclick: () => { exportProcessSheet(open.project, scheme); toast('工序单已生成并下载', 'ok'); },
      }),
    ]),
    h('button', {
      class: 'btn primary', textContent: '保存工程',
      onclick: async () => { await store.saveCurrent(); toast('已保存', 'ok'); },
    }),
  );
}

export function disposeWeatheringPanel(): void {
  panel?.dispose();
  panel = null;
}
