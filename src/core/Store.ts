// 全局应用状态 (单例 + 发布订阅), 串起存储、当前工程与六个页面
import { Project, Scheme, makeId, makeScheme } from './materials';
import { db, meshToStored, StoredMesh } from './Storage';
import { Mesh } from './Mesh';

export interface OpenProject {
  project: Project;
  mesh: Mesh;
  dirty: boolean;
}

type Listener = () => void;

class AppStore {
  projects: Project[] = [];
  current: OpenProject | null = null;
  page: 'works' | 'import' | 'process' | 'weathering' | 'compare' | 'settings' = 'works';
  /** 对比页选中的两个方案 id */
  compareIds: [string, string] | null = null;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { this.listeners.forEach((fn) => fn()); }

  async loadList(): Promise<void> {
    this.projects = await db.listProjects();
    this.emit();
  }

  goto(page: AppStore['page']): void {
    this.page = page;
    this.emit();
  }

  async createProject(name: string, mesh: Mesh, source: Project['source'], sourceFileName?: string): Promise<string> {
    const now = Date.now();
    const scheme = makeScheme('默认着色方案');
    const project: Project = {
      id: makeId('prj'),
      name,
      source,
      sourceFileName,
      decimateTarget: 0,
      rayCount: 12,
      createdAt: now,
      updatedAt: now,
      schemes: [scheme],
      activeSchemeId: scheme.id,
    };
    await db.putProject(project);
    await db.putMesh(meshToStored(project.id, mesh));
    await this.loadList();
    return project.id;
  }

  async openProject(id: string): Promise<void> {
    const project = await db.getProject(id);
    const stored = await db.getMesh(id);
    if (!project || !stored) throw new Error('工程数据不完整');
    const mesh = storedToMesh(stored, project.name);
    this.current = { project, mesh, dirty: false };
    this.emit();
  }

  closeProject(): void {
    this.current = null;
    this.goto('works');
  }

  async saveCurrent(): Promise<void> {
    if (!this.current) return;
    this.current.project.updatedAt = Date.now();
    this.current.project.schemes.forEach((s) => (s.updatedAt = Date.now()));
    await db.putProject(this.current.project);
    await db.putMesh(meshToStored(this.current.project.id, this.current.mesh));
    this.current.dirty = false;
    await this.loadList();
  }

  async deleteProject(id: string): Promise<void> {
    await db.deleteProject(id);
    if (this.current?.project.id === id) this.current = null;
    await this.loadList();
  }

  async duplicateProject(id: string): Promise<string> {
    const p = await db.getProject(id);
    const m = await db.getMesh(id);
    if (!p || !m) throw new Error('工程不存在');
    const newId = makeId('prj');
    const now = Date.now();
    const copy: Project = {
      ...structuredClone(p),
      id: newId,
      name: p.name + ' (副本)',
      createdAt: now,
      updatedAt: now,
      schemes: p.schemes.map((s) => ({ ...structuredClone(s), id: makeId('sch') })),
    };
    copy.activeSchemeId = copy.schemes[0].id;
    const meshCopy: StoredMesh = { ...structuredClone(m), projectId: newId };
    await db.putProject(copy);
    await db.putMesh(meshCopy);
    await this.loadList();
    return newId;
  }

  markDirty(): void {
    if (this.current) {
      this.current.dirty = true;
      this.emit();
    }
  }

  updateMesh(mesh: Mesh): void {
    if (!this.current) return;
    this.current.mesh = mesh;
    this.current.dirty = true;
    this.emit();
  }

  get activeScheme(): Scheme | null {
    if (!this.current) return null;
    return this.current.project.schemes.find((s) => s.id === this.current!.project.activeSchemeId) ?? null;
  }

  setActiveScheme(id: string): void {
    if (!this.current) return;
    this.current.project.activeSchemeId = id;
    this.markDirty();
  }

  addScheme(name: string): Scheme {
    const s = makeScheme(name);
    this.current!.project.schemes.push(s);
    this.current!.project.activeSchemeId = s.id;
    this.markDirty();
    return s;
  }

  removeScheme(id: string): void {
    if (!this.current || this.current.project.schemes.length <= 1) return;
    this.current.project.schemes = this.current.project.schemes.filter((s) => s.id !== id);
    if (this.current.project.activeSchemeId === id) {
      this.current.project.activeSchemeId = this.current.project.schemes[0].id;
    }
    this.markDirty();
  }
}

export function storedToMesh(m: StoredMesh, name: string): Mesh {
  return {
    name,
    positions: new Float32Array(m.positions),
    normals: new Float32Array(m.normals),
    indices: new Uint32Array(m.indices),
    curvature: new Float32Array(m.curvature),
    ao: new Float32Array(m.ao),
    bakeInfo: {
      vertexCount: new Float32Array(m.positions).length / 3,
      triangleCount: new Uint32Array(m.indices).length / 3,
      bakedAt: 0,
    },
  };
}

export const store = new AppStore();
