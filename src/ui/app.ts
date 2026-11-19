import type { Project, Tower, Corridor, VoltageKv } from '../types';
import { DesignStore, newId } from '../model/store';
import { generateTerrain } from '../model/terrain';
import { autoSpot } from '../model/autoSpot';
import { defaultLoadCases, TOWER_LIBRARY, conductorById } from '../data/libraries';
import { idbGetAll, idbPut, idbDelete, idbByProject } from '../data/db';
import { renderProjectPage } from './pages/projectPage';
import { renderSpottingPage } from './pages/spottingPage';
import { renderConditionsPage } from './pages/conditionsPage';
import { renderCheck3dPage } from './pages/check3dPage';
import { renderCrossingsPage } from './pages/crossingsPage';
import { renderOutputPage } from './pages/outputPage';
import type { Scene3D } from '../three/scene3d';

export const PAGES = [
  ['project', '线路工程'],
  ['spotting', '杆塔排位'],
  ['conditions', '导线工况'],
  ['check3d', '三维校核'],
  ['crossings', '交叉跨越'],
  ['output', '成果输出'],
] as const;
export type PageId = typeof PAGES[number][0];

export class App {
  store = new DesignStore();
  projects: Project[] = [];
  scene3d: Scene3D | null = null;
  pendingFocusStation: number | null = null;
  private cleanup: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init() {
    this.projects = await idbGetAll<Project>('projects');
    const lastId = localStorage.getItem('lastProjectId');
    const last = this.projects.find(p => p.id === lastId) ?? this.projects[0];
    if (last) await this.openProject(last.id);
    else await this.createProject('示例工程 220kV', 220, 'LGJ-400/35', 3000, 20260601);
    window.addEventListener('hashchange', () => this.renderPage());
    this.renderNav();
    this.renderPage();
  }

  async createProject(name: string, voltageKv: VoltageKv, conductorId: string,
    length: number, seed: number) {
    const project: Project = {
      id: newId('p'), name, voltageKv, conductorId,
      corridorLength: length, terrainSeed: seed, createdAt: Date.now(),
      refCaseId: 'ice',
      refSigma: conductorById(conductorId).rts / conductorById(conductorId).area / 2.5,
      loadCases: defaultLoadCases(),
    };
    const terrain = generateTerrain(seed, length);
    const corridor: Corridor = { ...terrain.corridor, projectId: project.id };
    this.store.project = project;
    this.store.terrain = terrain;
    this.store.towers = [];
    // 默认自动排位
    const susp = TOWER_LIBRARY.find(t => t.voltageKv === voltageKv && t.kind === 'suspension')!;
    const strain = TOWER_LIBRARY.find(t => t.voltageKv === voltageKv && t.kind !== 'suspension')!;
    this.store.towers = autoSpot(this.store, {
      typeId: susp.id, height: susp.defaultHeight,
      maxSpan: susp.maxSpan, minSpan: 150, margin: 1.0, strainTypeId: strain.id,
    });
    this.store.recompute();
    await idbPut('projects', project);
    await idbPut('corridors', corridor);
    await this.persistTowers();
    this.projects = await idbGetAll('projects');
    localStorage.setItem('lastProjectId', project.id);
  }

  async openProject(id: string) {
    const project = this.projects.find(p => p.id === id) ?? await idbGetAll<Project>('projects')
      .then(ps => ps.find(p => p.id === id));
    if (!project) return;
    const corridor = (await idbByProject<Corridor>('corridors', id))[0];
    const towers = await idbByProject<Tower>('towers', id);
    this.store.project = project;
    this.store.terrain = generateTerrain(project.terrainSeed, project.corridorLength);
    if (corridor) this.store.terrain.corridor.projectId = id;
    this.store.towers = towers;
    this.store.activeCaseId = 'maxtemp';
    this.store.recompute();
    localStorage.setItem('lastProjectId', id);
  }

  async deleteProject(id: string) {
    await idbDelete('projects', id);
    const towers = await idbByProject<Tower>('towers', id);
    for (const t of towers) await idbDelete('towers', t.id);
    const corridors = await idbByProject<Corridor>('corridors', id);
    for (const c of corridors) await idbDelete('corridors', c.id);
    this.projects = await idbGetAll('projects');
    if (this.store.project?.id === id) {
      if (this.projects[0]) await this.openProject(this.projects[0].id);
      else await this.createProject('示例工程 220kV', 220, 'LGJ-400/35', 3000, 20260601);
    }
  }

  /** 防抖持久化 */
  persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      await idbPut('projects', this.store.project);
      await this.persistTowers();
    }, 400);
  }

  private async persistTowers() {
    const old = await idbByProject<Tower>('towers', this.store.project.id);
    for (const t of old) await idbDelete('towers', t.id);
    for (const t of this.store.towers) await idbPut('towers', { ...t });
  }

  mutate(fn: () => void) {
    fn();
    this.store.recompute();
    this.persist();
  }

  focus3d(station: number) {
    this.pendingFocusStation = station;
    if (location.hash === '#/check3d') {
      this.scene3d?.focusStation(station);
    } else {
      location.hash = '#/check3d';
    }
  }

  private renderNav() {
    const nav = document.getElementById('nav')!;
    nav.innerHTML = '';
    for (const [id, label] of PAGES) {
      const a = document.createElement('a');
      a.href = `#/${id}`;
      a.textContent = label;
      a.dataset.page = id;
      nav.append(a);
    }
  }

  renderPage() {
    const id = (location.hash.replace('#/', '') || 'project') as PageId;
    document.querySelectorAll('#nav a').forEach(a =>
      a.classList.toggle('active', (a as HTMLAnchorElement).dataset.page === id));
    this.cleanup?.();
    this.cleanup = null;
    this.scene3d = null;
    const root = document.getElementById('page')!;
    root.innerHTML = '';
    const pages: Record<PageId, (r: HTMLElement, app: App) => void | (() => void)> = {
      project: renderProjectPage,
      spotting: renderSpottingPage,
      conditions: renderConditionsPage,
      check3d: renderCheck3dPage,
      crossings: renderCrossingsPage,
      output: renderOutputPage,
    };
    const cleanup = (pages[id] ?? renderProjectPage)(root, this);
    if (typeof cleanup === 'function') this.cleanup = cleanup;
  }
}
