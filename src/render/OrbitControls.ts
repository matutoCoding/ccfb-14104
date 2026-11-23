// 轨道相机控制器: 左键旋转, 右键平移, 滚轮缩放; 支持双实例状态同步
import { CameraState } from './Renderer';
import { Vec3 } from '../math/vecmath';

export class OrbitControls {
  state: CameraState = { yaw: 0.6, pitch: 0.25, distance: 4.2, target: [0, -0.1, 0] };
  private dragging: 'rotate' | 'pan' | null = null;
  private lastX = 0;
  private lastY = 0;
  /** 同步回调: 方案对比页用它把镜头状态推给另一台相机 */
  onSync?: (s: CameraState) => void;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = e.button === 2 ? 'pan' : 'rotate';
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.el.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.dragging === 'rotate') {
      this.state.yaw -= dx * 0.008;
      this.state.pitch = Math.max(-1.4, Math.min(1.4, this.state.pitch + dy * 0.008));
    } else {
      const s = this.state.distance * 0.0015;
      const right: Vec3 = [Math.cos(this.state.yaw), 0, -Math.sin(this.state.yaw)];
      const up: Vec3 = [0, 1, 0];
      this.state.target = [
        this.state.target[0] - right[0] * dx * s,
        this.state.target[1] + dy * s,
        this.state.target[2] - right[2] * dx * s,
      ];
      void up;
    }
    this.onSync?.(this.state);
  };

  private onUp = () => { this.dragging = null; };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.state.distance = Math.max(1.2, Math.min(12, this.state.distance * (1 + Math.sign(e.deltaY) * 0.08)));
    this.onSync?.(this.state);
  };

  setState(s: CameraState): void {
    this.state = { ...s, target: [...s.target] as Vec3 };
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
  }
}
