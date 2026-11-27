'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface OpenedArtifact {
  id: string;
  file: File;
  domain: 'video' | 'audio' | 'pdf' | 'image';
  sourceToolHref?: string;
  createdAt: number;
}

const MAX_SESSION_FILES = 8;
const MAX_PERSIST_BYTES = 28 * 1024 * 1024;
const SESSION_DB_NAME = 'muxaro_session_store';
const SESSION_STORE_NAME = 'active_files';

interface PersistedSessionEntry {
  id: string;
  name: string;
  type: string;
  lastModified: number;
  domain: OpenedArtifact['domain'];
  sourceToolHref?: string;
  createdAt: number;
  buffer: ArrayBuffer;
}

function openSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(SESSION_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        db.createObjectStore(SESSION_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function persistSessionFilesToIdb(items: OpenedArtifact[]): Promise<void> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  try {
    const db = await openSessionDb();
    const entries: PersistedSessionEntry[] = [];
    for (const item of items.slice(0, 4)) {
      if (item.file.size > MAX_PERSIST_BYTES) continue;
      const buffer = await item.file.arrayBuffer();
      entries.push({
        id: item.id,
        name: item.file.name,
        type: item.file.type || 'application/octet-stream',
        lastModified: item.file.lastModified || item.createdAt,
        domain: item.domain,
        sourceToolHref: item.sourceToolHref,
        createdAt: item.createdAt,
        buffer,
      });
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SESSION_STORE_NAME);
      store.clear();
      for (const e of entries) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Gracefully degrade on QuotaExceededError or private mode without dropping in-memory files
  }
}

async function restoreSessionFilesFromIdb(): Promise<OpenedArtifact[]> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return [];
  try {
    const db = await openSessionDb();
    const rows = await new Promise<PersistedSessionEntry[]>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE_NAME, 'readonly');
      const store = tx.objectStore(SESSION_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []) as PersistedSessionEntry[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows
      .filter((r) => r && r.buffer && r.buffer.byteLength > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.id,
        file: new File([r.buffer], r.name, { type: r.type, lastModified: r.lastModified }),
        domain: r.domain,
        sourceToolHref: r.sourceToolHref,
        createdAt: r.createdAt,
      }));
  } catch {
    return [];
  }
}

interface OpenedArtifactContextValue {
  artifact: OpenedArtifact | null;
  sessionFiles: OpenedArtifact[];
  storageNotice: string | null;
  setArtifactFromBlob: (
    blob: Blob,
    fileName: string,
    domain: OpenedArtifact['domain'],
    sourceToolHref?: string
  ) => OpenedArtifact;
  setArtifactFromFile: (
    file: File,
    domain: OpenedArtifact['domain'],
    sourceToolHref?: string
  ) => OpenedArtifact;
  selectSessionFile: (id: string) => OpenedArtifact | null;
  removeSessionFile: (id: string) => void;
  clearArtifact: () => void;
}

const OpenedArtifactContext = createContext<OpenedArtifactContextValue | null>(null);

function makeArtifact(
  file: File,
  domain: OpenedArtifact['domain'],
  sourceToolHref?: string
): OpenedArtifact {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    domain,
    sourceToolHref,
    createdAt: Date.now(),
  };
}

/**
 * Shared Session File Shelf & IndexedDB-Backed Cross-Tool Artifact Context.
 * Keeps active files loaded across Studio, PDF, and Media transitions with zero server uploads.
 */
export function OpenedArtifactProvider({ children }: { children: React.ReactNode }) {
  const [sessionFiles, setSessionFiles] = useState<OpenedArtifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void restoreSessionFilesFromIdb().then((restored) => {
      if (!mounted || restored.length === 0) return;
      setSessionFiles((prev) => (prev.length > 0 ? prev : restored));
      setActiveId((prev) => prev || restored[0]?.id || null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const artifact = sessionFiles.find((item) => item.id === activeId) ?? sessionFiles[0] ?? null;

  const upsertArtifact = useCallback((next: OpenedArtifact) => {
    setSessionFiles((prev) => {
      const filtered = prev.filter(
        (item) => !(item.file.name === next.file.name && item.file.size === next.file.size && item.domain === next.domain)
      );
      const updated = [next, ...filtered].slice(0, MAX_SESSION_FILES);
      void persistSessionFilesToIdb(updated).catch(() => {
        setStorageNotice('Local storage space is tight; keeping current session in memory.');
      });
      return updated;
    });
    setActiveId(next.id);
    return next;
  }, []);

  const setArtifactFromFile = useCallback(
    (file: File, domain: OpenedArtifact['domain'], sourceToolHref?: string) => {
      return upsertArtifact(makeArtifact(file, domain, sourceToolHref));
    },
    [upsertArtifact]
  );

  const setArtifactFromBlob = useCallback(
    (
      blob: Blob,
      fileName: string,
      domain: OpenedArtifact['domain'],
      sourceToolHref?: string
    ) => {
      const file = new File([blob], fileName, {
        type: blob.type || (domain === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
        lastModified: Date.now(),
      });
      return upsertArtifact(makeArtifact(file, domain, sourceToolHref));
    },
    [upsertArtifact]
  );

  const selectSessionFile = useCallback(
    (id: string) => {
      const found = sessionFiles.find((item) => item.id === id) ?? null;
      if (found) setActiveId(found.id);
      return found;
    },
    [sessionFiles]
  );

  const removeSessionFile = useCallback((id: string) => {
    setSessionFiles((prev) => {
      const remaining = prev.filter((item) => item.id !== id);
      setActiveId((curr) => (curr === id ? remaining[0]?.id ?? null : curr));
      void persistSessionFilesToIdb(remaining);
      return remaining;
    });
  }, []);

  const clearArtifact = useCallback(() => {
    setActiveId(null);
    setSessionFiles([]);
    void persistSessionFilesToIdb([]);
  }, []);

  return (
    <OpenedArtifactContext.Provider
      value={{
        artifact,
        sessionFiles,
        storageNotice,
        setArtifactFromBlob,
        setArtifactFromFile,
        selectSessionFile,
        removeSessionFile,
        clearArtifact,
      }}
    >
      {children}
    </OpenedArtifactContext.Provider>
  );
}

export function useOpenedArtifact(): OpenedArtifactContextValue {
  const ctx = useContext(OpenedArtifactContext);
  if (!ctx) {
    return {
      artifact: null,
      sessionFiles: [],
      storageNotice: null,
      setArtifactFromBlob: (blob, fileName, domain, sourceToolHref) =>
        makeArtifact(new File([blob], fileName, { type: blob.type }), domain, sourceToolHref),
      setArtifactFromFile: (file, domain, sourceToolHref) =>
        makeArtifact(file, domain, sourceToolHref),
      selectSessionFile: () => null,
      removeSessionFile: () => {},
      clearArtifact: () => {},
    };
  }
  return ctx;
}
