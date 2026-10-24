import type { TudBridge } from '../src/lib/tud-bridge';

declare global {
  interface Window {
    /** Desktop shell bridge (Electron preload / Tauri injected init script). */
    tud?: TudBridge;
  }
}

export {};
