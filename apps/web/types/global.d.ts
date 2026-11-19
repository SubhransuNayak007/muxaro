export {};

declare global {
  interface Window {
    __MUXARO_DIRECT_ACTIVE__?: boolean;
    __MUXARO_DIRECT_VERSION__?: string;
  }
}
