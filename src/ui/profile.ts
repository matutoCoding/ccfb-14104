import type { DesignStore } from '../model/store';

/**
 * 纵断面图：地形线、安全距离包络线、杆塔、导线（当前工况）、最大弧垂线。
 * 交互：拖动杆塔沿中心线移动（实时重算）；点击空白处 → 三维跳转。
 */
export class ProfileView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private unsub: (() => void) | null = null;
  private dragTowerId: string | null = null;
  private hoverTowerId: string | null = null;
  onStationClick: ((station: number) => void) | null = null;
  onTowerDragged: (() => void) | null = null;

  constructor(private container: HTMLElement, private store: DesignStore) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.unsub = store.onChange(() => this.draw());
    new ResizeObserver(() => this.draw()).observe(container);

    this.canvas.addEventListener('pointerdown', e => {
      const t = this.towerAt(e);
      if (t) {
        this.dragTowerId = t.id;
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener('pointermove', e => {
      this.hoverTowerId = this.towerAt(e)?.id ?? null;
      this.canvas.style.cursor = this.hoverTowerId ? 'ew-resize' : 'crosshair';
      if (this.dragTowerId) {
        const t = this.store.towers.find(t => t.id === this.dragTowerId)!;
        const ts = this.store.sortedTowers();
        const i = ts.findIndex(x => x.id === t.id);
        const lo = (ts[i - 1]?.station ?? -Infinity) + 30;
        const hi = (ts[i + 1]?.station ?? Infinity) - 30;
        t.station = Math.min(hi, Math.max(lo, this.xToStation(e)));
        this.store.recompute();
        this.onTowerDragged?.();
      }
    });
    this.canvas.addEventListener('pointerup', e => {
      if (this.dragTowerId) { this.dragTowerId = null; return; }
      if (!this.towerAt(e)) this.onStationClick?.(this.xToStation(e));
    });
  }

  dispose() { this.unsub?.(); this.canvas.remove(); }

  private view() {
    const w = this.container.clientWidth || 900;
    const h = this.container.clientHeight || 320;
    const dpr = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== w * dpr) { this.canvas.width = w * dpr; this.canvas.height = h * dpr; }
    return { w, h, dpr };
  }

  private scales() {
    const { w, h } = this.view();
    const L = this.store.project.corridorLength;
    let zMin = Infinity, zMax = -Infinity;
    for (let x = 0; x <= L; x += 10) {
      const z = this.store.terrain.groundAt(x, 0);
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    }
    for (const t of this.store.towers) zMax = Math.max(zMax, this.store.crossarmZ(t) + 5);
    const padX = 50, padY = 30;
    const sx = (w - padX * 2) / L;
    const sz = (h - padY * 2) / Math.max(1, zMax - zMin);
    return { sx, sz, zMin, padX, padY, w, h };
  }

  private toPx(station: number, z: number): [number, number] {
    const { sx, sz, zMin, padX, h, padY } = this.scales();
    return [padX + station * sx, h - padY - (z - zMin) * sz];
  }
  private xToStation(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect();
    const { sx, padX } = this.scales();
    return Math.max(0, Math.min(this.store.project.corridorLength,
      (e.clientX - r.left - padX) / sx));
  }
  private towerAt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    return this.store.towers.find(t => {
      const [px, py] = this.toPx(t.station, this.store.crossarmZ(t));
      const [, gy] = this.toPx(t.station, this.store.towerGround(t));
      return Math.abs(px - mx) < 8 && my > py - 6 && my < gy + 6;
    });
  }

  draw() {
    const { w, h, dpr } = this.view();
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
    const st = this.store;
    if (!st.project) return;
    const L = st.project.corridorLength;
    const std = st.standards;

    const path = (pts: [number, number][], style: string, width = 1, dash: number[] = []) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      pts.forEach(([x, z], i) => {
        const [px, py] = this.toPx(x, z);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // 地形线
    const ground: [number, number][] = [];
    for (let x = 0; x <= L; x += 5) ground.push([x, st.terrain.groundAt(x, 0)]);
    path(ground, '#8b9a6b', 1.5);
    // 安全距离包络线（地面 + 对地要求）
    path(ground.map(([x, z]) => [x, z + std.ground] as [number, number]), '#c9a227', 1, [6, 4]);

    // 公路 / 河流 / 低压线标记
    const { road, river, lvLine } = st.terrain.corridor;
    for (const [x, label, color] of [
      [road.station, '公路', '#aaa'], [river.station, '河流', '#5af'],
      [lvLine.station, '低压线', '#fa5'],
    ] as const) {
      const [px, py] = this.toPx(x, st.terrain.groundAt(x, 0));
      ctx.fillStyle = color;
      ctx.font = '11px sans-serif';
      ctx.fillText(label, px - 12, py + 16);
      ctx.fillRect(px - 0.5, py, 1, 14);
    }

    // 导线（当前工况）
    for (const span of st.spans) {
      const geo = st.spanGeometry(span, st.activeCaseId, 48);
      path(geo.points.map(p => [p[0], p[2]] as [number, number]), '#e8e8e8', 1.2);
    }
    // 最大弧垂线（最高温工况，若不是当前工况）
    const hot = st.project.loadCases.find(c => c.id === 'maxtemp');
    if (hot && st.activeCaseId !== hot.id) {
      for (const span of st.spans) {
        const geo = st.spanGeometry(span, hot.id, 32);
        path(geo.points.map(p => [p[0], p[2]] as [number, number]), '#ff7b72', 1, [3, 3]);
      }
    }

    // 杆塔
    for (const t of st.towers) {
      const type = st.towerType(t);
      const [px, pyTop] = this.toPx(t.station, this.store.crossarmZ(t));
      const [, pyG] = this.toPx(t.station, this.store.towerGround(t));
      ctx.strokeStyle = this.hoverTowerId === t.id ? '#ffd54f'
        : type.kind === 'suspension' ? '#4a90d9' : '#e08a2e';
      ctx.lineWidth = this.hoverTowerId === t.id ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(px, pyG);
      ctx.lineTo(px, pyTop);
      ctx.moveTo(px - 8, pyTop);
      ctx.lineTo(px + 8, pyTop);
      ctx.stroke();
      ctx.fillStyle = '#9db2c9';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${type.name.split('（')[0]} ${t.station.toFixed(0)}m`, px - 20, pyTop - 4);
    }

    // 档距标注
    ctx.fillStyle = '#6e8199';
    ctx.font = '10px sans-serif';
    for (const span of st.spans) {
      const ts = st.sortedTowers();
      const L2 = ts.find(t => t.id === span.leftTowerId)!;
      const [px] = this.toPx(L2.station + span.l / 2, 0);
      const [, py] = this.toPx(0, st.terrain.groundAt(L2.station + span.l / 2, 0));
      ctx.fillText(`${span.l.toFixed(0)}`, px - 10, py - 4);
    }
  }
}
