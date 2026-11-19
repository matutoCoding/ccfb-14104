import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DesignStore } from '../model/store';
import type { Tower } from '../types';

const KIND_COLOR = { suspension: 0x4a90d9, strain: 0xe08a2e, angle: 0xd94a4a };

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private store!: DesignStore;
  private staticGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private dragTower: Tower | null = null;
  private unsub: (() => void) | null = null;
  private disposed = false;
  showAllClearanceLines = false;
  onTowerDragged: (() => void) | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);
    this.camera.up.set(0, 0, 1); // Z 轴向上（与线路专业坐标一致）
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.scene.add(this.staticGroup, this.dynamicGroup);
    this.scene.background = new THREE.Color(0x101820);
    this.scene.fog = new THREE.Fog(0x101820, 2000, 12000);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.4, 0.5, 1);
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, 0.9));

    this.renderer.domElement.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.loop();
  }

  private onMove = (e: PointerEvent) => {
    if (!this.dragTower || !this.store) return;
    const station = this.pickStation(e);
    if (station == null) return;
    const ts = this.store.sortedTowers();
    const i = ts.findIndex(t => t.id === this.dragTower!.id);
    const lo = (ts[i - 1]?.station ?? -Infinity) + 30;
    const hi = (ts[i + 1]?.station ?? Infinity) - 30;
    this.dragTower.station = Math.min(hi, Math.max(lo, station));
    this.store.recompute();
    this.onTowerDragged?.();
  };
  private onUp = () => { this.dragTower = null; this.controls.enabled = true; };

  private pointerRay(e: PointerEvent): THREE.Raycaster {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  /** 射线与中心线竖直面 (y=0) 求交，取里程 */
  private pickStation(e: PointerEvent): number | null {
    const ray = this.pointerRay(e).ray;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return ray.intersectPlane(plane, pt) ? pt.x : null;
  }

  private onDown(e: PointerEvent) {
    if (!this.store) return;
    const ray = this.pointerRay(e);
    const hits = ray.intersectObjects(this.dynamicGroup.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.towerId) o = o.parent;
      if (o) {
        const t = this.store.towers.find(t => t.id === o!.userData.towerId);
        if (t) { this.dragTower = t; this.controls.enabled = false; }
        return;
      }
    }
  }

  setStore(store: DesignStore) {
    this.store = store;
    this.unsub?.();
    this.unsub = store.onChange(() => this.rebuildDynamic());
    this.rebuildStatic();
    this.rebuildDynamic();
    const L = store.project.corridorLength;
    this.focusStation(L / 2, L * 0.9);
  }

  focusStation(x: number, dist = 500) {
    const z = this.store?.terrain.groundAt(x, 0) ?? 0;
    this.controls.target.set(x, 0, z);
    this.camera.position.set(x - dist * 0.35, -dist, z + dist * 0.45);
    this.controls.update();
  }

  // ---------- 静态场景 ----------
  private rebuildStatic() {
    disposeGroup(this.staticGroup);
    const st = this.store;
    const L = st.project.corridorLength;
    const { trees, road, river, lvLine } = st.terrain.corridor;

    // 地形网格
    const nx = Math.ceil((L + 200) / 12), ny = 34, w = 340;
    const geo = new THREE.PlaneGeometry(L + 200, w, nx, ny);
    geo.rotateX(Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + L / 2, y = pos.getZ(i);
      const z = st.terrain.groundAt(x, y);
      pos.setX(i, x); pos.setZ(i, y); pos.setY(i, 0);
      pos.setXYZ(i, x, y, z);
      const t = Math.min(1, Math.max(0, (z - 5) / 90));
      c.setHSL(0.28 - t * 0.16, 0.45, 0.32 + t * 0.25);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.staticGroup.add(new THREE.Mesh(geo,
      new THREE.MeshLambertMaterial({ vertexColors: true })));

    // 河流
    this.staticGroup.add(ribbon(st, river.station - river.width / 2, river.station + river.width / 2,
      0x2266aa, -0.4, true));
    // 公路
    this.staticGroup.add(ribbon(st, road.station - road.width / 2, road.station + road.width / 2,
      0x333333, 0.25, false));

    // 树（实例化）
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 3, 5),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2b }), trees.length);
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 6),
      new THREE.MeshLambertMaterial({ color: 0x2d6b2d }), trees.length);
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      const gz = st.terrain.groundAt(t.x, t.y);
      m.makeScale(1, 1, 1).setPosition(t.x, t.y, gz + 1.5);
      trunk.setMatrixAt(i, m);
      m.makeScale(t.r, t.r, t.h).setPosition(t.x, t.y, gz + 2 + t.h / 2);
      crown.setMatrixAt(i, m);
    });
    this.staticGroup.add(trunk, crown);

    // 低压线：两根杆 + 一条线
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
    for (const y of [-45, 45]) {
      const gz = st.terrain.groundAt(lvLine.station, y);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.4, lvLine.poleHeight, 6), poleMat);
      pole.rotation.x = Math.PI / 2;
      pole.position.set(lvLine.station, y, gz + lvLine.poleHeight / 2);
      this.staticGroup.add(pole);
    }
    const lvPts: THREE.Vector3[] = [];
    for (let y = -45; y <= 45; y += 3) {
      const sag = 1.2 * (1 - (y / 80) ** 2);
      lvPts.push(new THREE.Vector3(lvLine.station, y,
        st.terrain.groundAt(lvLine.station, y) + lvLine.poleHeight - sag));
    }
    this.staticGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(lvPts),
      new THREE.LineBasicMaterial({ color: 0xcccccc })));
  }

  // ---------- 动态场景（杆塔、导线、校核线） ----------
  private rebuildDynamic() {
    if (this.disposed) return;
    disposeGroup(this.dynamicGroup);
    const st = this.store;
    if (!st?.project) return;
    const caseId = st.activeCaseId;
    const conductor = st.conductor;

    // 杆塔
    for (const t of st.towers) {
      const type = st.towerType(t);
      const gz = st.towerGround(t);
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 3.2, t.height, 4),
        new THREE.MeshLambertMaterial({ color: KIND_COLOR[type.kind] }));
      body.rotation.x = Math.PI / 2;
      body.rotation.y = Math.PI / 4;
      body.position.z = t.height / 2;
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(2, 14 + st.project.voltageKv / 40, 1.5),
        new THREE.MeshLambertMaterial({ color: KIND_COLOR[type.kind] }));
      arm.position.z = t.height;
      g.add(body, arm);
      g.position.set(t.station, 0, gz);
      g.userData.towerId = t.id;
      this.dynamicGroup.add(g);

      // 绝缘子串（随风偏摆）
      if (type.kind === 'suspension') {
        const attach = st.attachPoint(t, caseId);
        const sg = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(t.station, 0, st.crossarmZ(t)),
          new THREE.Vector3(...attach),
        ]);
        this.dynamicGroup.add(new THREE.Line(sg,
          new THREE.LineBasicMaterial({ color: 0xffd54f })));
      }
    }

    // 导线（分裂子导线 + 间隔棒）
    const wireMat = new THREE.LineBasicMaterial({ color: 0xf0f0f0 });
    const spacerMat = new THREE.LineBasicMaterial({ color: 0x90caf9 });
    const n = Math.max(1, conductor.subConductors);
    const s = conductor.subSpacing;
    const offsets: [number, number][] =
      n === 1 ? [[0, 0]] :
      n === 2 ? [[-s / 2, 0], [s / 2, 0]] :
      [[-s / 2, -s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [s / 2, s / 2]];
    for (const span of st.spans) {
      const geo = st.spanGeometry(span, caseId, 48);
      const dx = geo.attachR[0] - geo.attachL[0];
      const dy = geo.attachR[1] - geo.attachL[1];
      const l = Math.hypot(dx, dy) || 1;
      const px = -dy / l, py = dx / l;
      const subPts = offsets.map(([ox, oz]) => geo.points.map(p =>
        new THREE.Vector3(p[0] + px * ox, p[1] + py * ox, p[2] + oz)));
      for (const pts of subPts) {
        this.dynamicGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts), wireMat));
      }
      // 间隔棒：每 ~100m 一个十字
      if (n > 1) {
        const step = Math.max(1, Math.round(geo.points.length / (l / 100)));
        const segPts: THREE.Vector3[] = [];
        for (let i = 0; i < geo.points.length; i += step) {
          for (let k = 0; k < subPts.length; k++) {
            segPts.push(subPts[k][i], subPts[(k + 1) % subPts.length][i]);
          }
        }
        this.dynamicGroup.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(segPts), spacerMat));
      }
    }

    // 校核最近点连线
    const segs: THREE.Vector3[] = [];
    const colors: number[] = [];
    const col = new THREE.Color();
    for (const r of st.clearances) {
      const margin = (r.value - r.required) / r.required;
      if (!this.showAllClearanceLines && r.pass && margin > 0.15) continue;
      col.set(r.pass ? (margin > 0.15 ? 0x4caf50 : 0xffb300) : 0xff1744);
      segs.push(new THREE.Vector3(...r.a), new THREE.Vector3(...r.b));
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
      if (!r.pass) this.dynamicGroup.add(makeLabel(`${r.kindLabel} ${r.value.toFixed(1)}/${r.required}m`,
        (r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2));
    }
    const cg = new THREE.BufferGeometry().setFromPoints(segs);
    cg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.dynamicGroup.add(new THREE.LineSegments(cg,
      new THREE.LineBasicMaterial({ vertexColors: true })));
  }

  private resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    this.unsub?.();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

function ribbon(st: DesignStore, x0: number, x1: number, color: number, dz: number, flat: boolean) {
  const pts: THREE.Vector3[] = [];
  const idx: number[] = [];
  let k = 0;
  for (let y = -170; y <= 170; y += 10) {
    for (const x of [x0, x1]) {
      const z = flat ? Math.min(st.terrain.groundAt(x0, y), st.terrain.groundAt(x1, y)) + dz
        : st.terrain.groundAt(x, y) + dz;
      pts.push(new THREE.Vector3(x, y, z));
    }
    if (k > 0) {
      const a = (k - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    k++;
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    color, transparent: true, opacity: flat ? 0.8 : 1,
  }));
}

function makeLabel(text: string, x: number, y: number, z: number): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(120,0,0,0.85)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 48);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), depthTest: false,
  }));
  sp.scale.set(40, 7.5, 1);
  sp.position.set(x, y, z + 8);
  return sp;
}

function disposeGroup(g: THREE.Group) {
  g.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else mat?.dispose();
  });
  g.clear();
}
