// IndexedDB 持久层: projects 存元数据/方案, meshes 存几何二进制 (分库避免大对象拖慢列表)
import { Project } from './materials';

const DB_NAME = 'patina-studio';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_MESHES = 'meshes';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_MESHES)) db.createObjectStore(STORE_MESHES, { keyPath: 'projectId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export interface StoredMesh {
  projectId: string;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  indices: ArrayBuffer;
  curvature: ArrayBuffer;
  ao: ArrayBuffer;
}

export const db = {
  async listProjects(): Promise<Project[]> {
    const all = await tx(STORE_PROJECTS, 'readonly', (s) => s.getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getProject(id: string): Promise<Project | undefined> {
    return tx(STORE_PROJECTS, 'readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);
  },
  async putProject(p: Project): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.put(p));
  },
  async deleteProject(id: string): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
    await tx(STORE_MESHES, 'readwrite', (s) => s.delete(id)).catch(() => undefined);
  },
  async putMesh(m: StoredMesh): Promise<void> {
    await tx(STORE_MESHES, 'readwrite', (s) => s.put(m));
  },
  async getMesh(projectId: string): Promise<StoredMesh | undefined> {
    return tx(STORE_MESHES, 'readonly', (s) => s.get(projectId) as IDBRequest<StoredMesh | undefined>);
  },
};

export function meshToStored(projectId: string, mesh: {
  positions: Float32Array; normals: Float32Array; indices: Uint32Array;
  curvature: Float32Array; ao: Float32Array;
}): StoredMesh {
  const copy = (a: Float32Array | Uint32Array) => {
    const buf = new ArrayBuffer(a.byteLength);
    new Uint8Array(buf).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    return buf;
  };
  return {
    projectId,
    positions: copy(mesh.positions),
    normals: copy(mesh.normals),
    indices: copy(mesh.indices),
    curvature: copy(mesh.curvature),
    ao: copy(mesh.ao),
  };
}
