/**
 * MUXARO Origin Private File System (OPFS) Manager
 * Provides fast, private, asynchronous file operations for large media files
 * off the main thread with persistent local caching and zero memory exhaustion.
 */

export async function isOPFSSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return false;
  }
  return typeof navigator.storage.getDirectory === 'function';
}

export async function saveToOPFS(
  fileName: string,
  data: Blob | ArrayBuffer | Uint8Array
): Promise<boolean> {
  try {
    if (!(await isOPFSSupported())) return false;
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    // In web workers or modern browsers createWritable is standard
    if ('createWritable' in handle) {
      const writable = await handle.createWritable();
      if (data instanceof Blob) {
        await writable.write(data);
      } else if (data instanceof Uint8Array) {
        await writable.write(data as any);
      } else {
        await writable.write(new Uint8Array(data) as any);
      }
      await writable.close();
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[OPFS] Write failed, falling back to in-memory FS:', err);
    return false;
  }
}

export async function readFromOPFS(fileName: string): Promise<Blob | null> {
  try {
    if (!(await isOPFSSupported())) return null;
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName);
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteFromOPFS(fileName: string): Promise<boolean> {
  try {
    if (!(await isOPFSSupported())) return false;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
    return true;
  } catch {
    return false;
  }
}

export async function clearOPFSTemp(): Promise<void> {
  try {
    if (!(await isOPFSSupported())) return;
    const root = await navigator.storage.getDirectory();
    // @ts-expect-error - AsyncIterable is standard on OPFS directory handles
    for await (const [name, handle] of root.entries()) {
      if (name.startsWith('muxaro_') || name.startsWith('input_') || name.startsWith('output_')) {
        try {
          await root.removeEntry(name);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}
