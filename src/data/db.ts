/** 极简 IndexedDB 封装（Promise 化） */

const DB_NAME = 'line-spotting';
const DB_VERSION = 1;
export const STORES = ['projects', 'towers', 'corridors'] as const;
export type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (name !== 'projects') store.createIndex('projectId', 'projectId', { unique: false });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store);
}

export async function idbPut<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readwrite').put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbByProject<T>(store: StoreName, projectId: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readonly').index('projectId').getAll(projectId);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(store: StoreName, id: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = tx(db, store, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
