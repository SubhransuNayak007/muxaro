import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface DesktopSaveRequest {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface DesktopDiagnostics {
  platform: string;
  arch: string;
  cpus: number;
  hasFfmpeg: boolean;
  hasYtdlp: boolean;
  ffmpegPath: string;
  ytdlpPath: string;
  downloadsDir: string;
  localPort: number;
}

contextBridge.exposeInMainWorld('muxaroDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '1.1.0',
  localPort: Number(process.env.MUXARO_DESKTOP_PORT || '0'),
  hasLocalFfmpeg: (): Promise<boolean> => ipcRenderer.invoke('muxaro:has-ffmpeg'),
  hasLocalYtdlp: (): Promise<boolean> => ipcRenderer.invoke('muxaro:has-ytdlp'),
  getDiagnostics: (): Promise<DesktopDiagnostics> => ipcRenderer.invoke('muxaro:diagnostics'),
  probeUrl: (url: string) => ipcRenderer.invoke('muxaro:probe-url', url),
  downloadLocal: (opts: {
    url: string;
    formatId?: string;
    mode?: 'video' | 'audio' | 'compact';
    quality?: string;
  }) => ipcRenderer.invoke('muxaro:download-local', opts),
  saveBlob: (opts: DesktopSaveRequest) => ipcRenderer.invoke('muxaro:save-blob', opts),
  openDownloadsFolder: (): Promise<void> => ipcRenderer.invoke('muxaro:open-downloads'),
  openFilePath: (filePath: string): Promise<boolean> => ipcRenderer.invoke('muxaro:open-file', filePath),
  showInFolder: (filePath: string): Promise<boolean> => ipcRenderer.invoke('muxaro:show-in-folder', filePath),
  captureScreenPng: (): Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }> =>
    ipcRenderer.invoke('muxaro:capture-screen'),
  getFilePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
});
