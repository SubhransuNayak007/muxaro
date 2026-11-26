import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopSaveRequest {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

contextBridge.exposeInMainWorld('muxaroDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
  localPort: Number(process.env.MUXARO_DESKTOP_PORT || '0'),
  hasLocalFfmpeg: (): Promise<boolean> => ipcRenderer.invoke('muxaro:has-ffmpeg'),
  hasLocalYtdlp: (): Promise<boolean> => ipcRenderer.invoke('muxaro:has-ytdlp'),
  probeUrl: (url: string) => ipcRenderer.invoke('muxaro:probe-url', url),
  downloadLocal: (opts: {
    url: string;
    formatId?: string;
    mode?: 'video' | 'audio' | 'compact';
    quality?: string;
  }) => ipcRenderer.invoke('muxaro:download-local', opts),
  saveBlob: (opts: DesktopSaveRequest) => ipcRenderer.invoke('muxaro:save-blob', opts),
  openDownloadsFolder: (): Promise<void> => ipcRenderer.invoke('muxaro:open-downloads'),
});
