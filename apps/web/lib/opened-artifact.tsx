'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

export interface OpenedArtifact {
  id: string;
  file: File;
  domain: 'video' | 'audio' | 'pdf' | 'image';
  sourceToolHref?: string;
  createdAt: number;
}

const MAX_SESSION_FILES = 8;

interface OpenedArtifactContextValue {
  artifact: OpenedArtifact | null;
  sessionFiles: OpenedArtifact[];
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
 * In-memory Session File Shelf & Cross-Tool Artifact Context.
 * Keeps active files loaded across tool switches with zero server uploads.
 */
export function OpenedArtifactProvider({ children }: { children: React.ReactNode }) {
  const [sessionFiles, setSessionFiles] = useState<OpenedArtifact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const artifact = sessionFiles.find((item) => item.id === activeId) ?? sessionFiles[0] ?? null;

  const upsertArtifact = useCallback((next: OpenedArtifact) => {
    setSessionFiles((prev) => {
      const filtered = prev.filter(
        (item) => !(item.file.name === next.file.name && item.file.size === next.file.size && item.domain === next.domain)
      );
      return [next, ...filtered].slice(0, MAX_SESSION_FILES);
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

  const removeSessionFile = useCallback(
    (id: string) => {
      setSessionFiles((prev) => {
        const remaining = prev.filter((item) => item.id !== id);
        setActiveId((curr) => (curr === id ? remaining[0]?.id ?? null : curr));
        return remaining;
      });
    },
    []
  );

  const clearArtifact = useCallback(() => {
    setActiveId(null);
  }, []);

  return (
    <OpenedArtifactContext.Provider
      value={{
        artifact,
        sessionFiles,
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
      setArtifactFromBlob: (blob, fileName, domain, sourceToolHref) =>
        makeArtifact(
          new File([blob], fileName, { type: blob.type }),
          domain,
          sourceToolHref
        ),
      setArtifactFromFile: (file, domain, sourceToolHref) =>
        makeArtifact(file, domain, sourceToolHref),
      selectSessionFile: () => null,
      removeSessionFile: () => {},
      clearArtifact: () => {},
    };
  }
  return ctx;
}
