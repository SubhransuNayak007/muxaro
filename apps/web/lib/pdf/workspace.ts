'use client';

export interface LocalWorkspaceOutputItem {
  id: string;
  fileName: string;
  toolName: string;
  toolHref: string;
  domain: 'pdf' | 'video';
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  blob?: Blob;
}

const DB_NAME = 'muxaro-local-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'outputs';
const MAX_ITEMS = 50;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open local workspace DB.'));
  });
}

export async function saveWorkspaceOutput(
  entry: Omit<LocalWorkspaceOutputItem, 'id' | 'createdAt'>
): Promise<LocalWorkspaceOutputItem | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const record: LocalWorkspaceOutputItem = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const all = await new Promise<LocalWorkspaceOutputItem[]>((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(((req.result as LocalWorkspaceOutputItem[]) || []).sort((a, b) => b.createdAt - a.createdAt));
      req.onerror = () => resolve([]);
    });

    if (all.length > MAX_ITEMS) {
      const toDelete = all.slice(MAX_ITEMS);
      await new Promise<void>((resolve) => {
        const tx = db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const item of toDelete) store.delete(item.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    return record;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function listWorkspaceOutputs(): Promise<LocalWorkspaceOutputItem[]> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const items = await new Promise<LocalWorkspaceOutputItem[]>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as LocalWorkspaceOutputItem[]) || []);
      req.onerror = () => reject(req.error);
    });
    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function deleteWorkspaceOutput(id: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
  } finally {
    db?.close();
  }
}

export async function clearAllWorkspaceOutputs(): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
  } finally {
    db?.close();
  }
}
