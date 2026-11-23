// 共享 3D 视图: 画布 + 轨道控制 + rAF 循环, 供所有页面复用
import { Renderer, CameraState } from '../render/Renderer';
import { OrbitControls } from '../render/OrbitControls';
import { Mesh } from '../core/Mesh';
import { ProcessLayer, WeatheringParams } from '../core/materials';
import { mat4Identity } from '../math/vecmath';

export class ViewPanel {
  renderer: Renderer;
  controls: OrbitControls;
  fpsEl: HTMLDivElement;
  private raf = 0;
  private alive = true;
  private getLayers: () => ProcessLayer[];
  private getWeathering: () => WeatheringParams;

  constructor(
    public container: HTMLElement,
    mesh: Mesh,
    getLayers: () => ProcessLayer[],
    getWeathering: () => WeatheringParams,
  ) {
    const canvas = document.createElement('canvas');
    canvas.className = 'view-canvas';
    container.append(canvas);
    this.renderer = new Renderer(canvas);
    this.renderer.uploadMesh(mesh);
    this.renderer.setModel(mat4Identity());
    this.controls = new OrbitControls(canvas);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps-badge';
    container.append(this.fpsEl);
    this.getLayers = getLayers;
    this.getWeathering = getWeathering;
    const loop = () => {
      if (!this.alive) return;
      this.renderer.render(this.controls.state, this.getLayers(), this.getWeathering());
      this.fpsEl.textContent = `${this.renderer.fps} FPS · ${(this.renderer.triangleCount / 10000).toFixed(1)}万面`;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  get camera(): CameraState { return this.controls.state; }
  set camera(s: CameraState) { this.controls.setState(s); }

  syncWith(other: ViewPanel): void {
    const apply = (s: CameraState) => this.controls.setState(s);
    other.controls.onSync = (s) => apply(s);
    this.controls.onSync = (s) => other.controls.setState(s);
  }

  renderOnce(): void {
    this.renderer.render(this.controls.state, this.getLayers(), this.getWeathering());
  }

  dispose(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
