'use client';

export interface SandboxExecutionOutput {
  ok: boolean;
  stdout: string;
  stderr: string;
  plotDataUrls: string[];
  outputFiles: File[];
  elapsedMs: number;
}

let activeWorker: Worker | null = null;

function resetWorker(): void {
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch {}
    activeWorker = null;
  }
}

function getOrCreateWorker(): Worker {
  if (!activeWorker) {
    activeWorker = new Worker('/workers/pyodide-worker.js');
  }
  return activeWorker;
}

function guessMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'csv') return 'text/csv;charset=utf-8';
  if (ext === 'json') return 'application/json;charset=utf-8';
  if (ext === 'txt' || ext === 'md') return 'text/plain;charset=utf-8';
  if (ext === 'png') return 'image/png';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Runs Python inside an isolated Web Worker Pyodide WASM container with hard wall-clock kill.
 * Mounted workspace files live at `/workspace/inputs/<name>` and outputs at `/workspace/outputs/`.
 */
export async function runPythonInSandbox(params: {
  code: string;
  inputFiles?: File[];
  timeoutMs?: number;
}): Promise<SandboxExecutionOutput> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return {
      ok: false,
      stdout: '',
      stderr: 'Python WASM sandbox requires a browser Web Worker runtime.',
      plotDataUrls: [],
      outputFiles: [],
      elapsedMs: 0,
    };
  }

  const t0 = performance.now();
  const timeoutMs = Math.min(45_000, Math.max(3000, params.timeoutMs || 20_000));
  const filesPayload = await Promise.all(
    (params.inputFiles || []).slice(0, 6).map(async (f) => ({
      name: f.name,
      bytes: new Uint8Array(await f.arrayBuffer()),
    }))
  );

  const worker = getOrCreateWorker();
  const runId = `py-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return await new Promise<SandboxExecutionOutput>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resetWorker();
      resolve({
        ok: false,
        stdout: '',
        stderr: `Execution timed out after ${Math.round(timeoutMs / 1000)}s (worker recycled safely).`,
        plotDataUrls: [],
        outputFiles: [],
        elapsedMs: Math.round(performance.now() - t0),
      });
    }, timeoutMs);

    const onMsg = (ev: MessageEvent) => {
      const data = ev.data || {};
      if (data.type !== 'result' || data.runId !== runId || settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMsg);

      const outputFiles: File[] = Array.isArray(data.files)
        ? data.files.map((item: { name: string; b64: string }) => {
            const bytes = base64ToUint8Array(item.b64);
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            return new File([copy], item.name, { type: guessMimeFromName(item.name) });
          })
        : [];

      resolve({
        ok: Boolean(data.ok),
        stdout: String(data.stdout || ''),
        stderr: String(data.stderr || ''),
        plotDataUrls: Array.isArray(data.plots) ? data.plots.map(String) : [],
        outputFiles,
        elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      });
    };

    worker.addEventListener('message', onMsg);
    worker.postMessage({
      type: 'exec',
      runId,
      code: params.code,
      files: filesPayload,
    });
  });
}
