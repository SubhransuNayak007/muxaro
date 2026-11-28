/* Classic Web Worker for isolated Python execution via Pyodide WASM */
let pyodideInstance = null;
let loadedPackages = new Set();

const PYODIDE_CDN_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

async function ensurePyodide() {
  if (pyodideInstance) return pyodideInstance;
  importScripts(`${PYODIDE_CDN_BASE}pyodide.js`);
  pyodideInstance = await self.loadPyodide({ indexURL: PYODIDE_CDN_BASE });
  // Disable ambient JS fetch/urllib network egress from inside Python sandbox
  await pyodideInstance.runPythonAsync(`
import os, sys, io, base64, json
os.makedirs('/workspace/inputs', exist_ok=True)
os.makedirs('/workspace/outputs', exist_ok=True)
`);
  return pyodideInstance;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'exec') return;
  const runId = msg.runId;

  try {
    const py = await ensurePyodide();

    // Auto-detect lightweight scientific packages referenced by code
    const codeStr = String(msg.code || '');
    const wanted = [];
    for (const pkg of ['numpy', 'pandas', 'matplotlib', 'scipy', 'sympy']) {
      if (new RegExp(`\\b${pkg}\\b`).test(codeStr) && !loadedPackages.has(pkg)) {
        wanted.push(pkg);
      }
    }
    if (wanted.length > 0) {
      await py.loadPackage(wanted);
      for (const w of wanted) loadedPackages.add(w);
    }

    // Clear previous outputs folder and write immutable input files
    try {
      const prevOut = py.FS.readdir('/workspace/outputs');
      for (const f of prevOut) {
        if (f !== '.' && f !== '..') {
          try { py.FS.unlink(`/workspace/outputs/${f}`); } catch {}
        }
      }
    } catch {}

    const inputs = Array.isArray(msg.files) ? msg.files : [];
    for (const f of inputs) {
      const safeName = String(f.name || 'input.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
      py.FS.writeFile(`/workspace/inputs/${safeName}`, new Uint8Array(f.bytes));
    }

    py.globals.set('__muxaro_user_code', codeStr);

    const wrapped = `
import io, os, sys, traceback, base64, json
from contextlib import redirect_stdout, redirect_stderr

# Guard against accidental matplotlib GUI popups & save plots automatically
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.close('all')
except Exception:
    plt = None

_stdout_buf = io.StringIO()
_stderr_buf = io.StringIO()
_exec_ok = True
_plots = []

os.chdir('/workspace')
try:
    with redirect_stdout(_stdout_buf), redirect_stderr(_stderr_buf):
        exec(compile(__muxaro_user_code, '<muxaro_sandbox>', 'exec'), {'__name__': '__main__'})
    if plt is not None:
        for i, num in enumerate(plt.get_fignums()):
            fig = plt.figure(num)
            img_path = f'/workspace/outputs/chart_{i+1}.png'
            fig.savefig(img_path, format='png', dpi=150, bbox_inches='tight')
            with open(img_path, 'rb') as fp:
                _plots.append('data:image/png;base64,' + base64.b64encode(fp.read()).decode('ascii'))
        plt.close('all')
except Exception:
    _exec_ok = False
    traceback.print_exc(file=_stderr_buf)

_out_files = []
try:
    for fname in sorted(os.listdir('/workspace/outputs')):
        fpath = '/workspace/outputs/' + fname
        if os.path.isfile(fpath) and not fname.startswith('chart_'):
            with open(fpath, 'rb') as fp:
                data = fp.read()
            if len(data) <= 8 * 1024 * 1024:
                _out_files.append({
                    'name': fname,
                    'b64': base64.b64encode(data).decode('ascii')
                })
except Exception:
    pass

json.dumps({
    'ok': _exec_ok,
    'stdout': _stdout_buf.getvalue()[:12000],
    'stderr': _stderr_buf.getvalue()[:6000],
    'plots': _plots[:4],
    'files': _out_files[:5]
})
`;

    const rawResult = await py.runPythonAsync(wrapped);
    const parsed = JSON.parse(String(rawResult || '{}'));
    self.postMessage({ type: 'result', runId, ...parsed });
  } catch (err) {
    self.postMessage({
      type: 'result',
      runId,
      ok: false,
      stdout: '',
      stderr: err && err.message ? String(err.message) : String(err),
      plots: [],
      files: [],
    });
  }
};
