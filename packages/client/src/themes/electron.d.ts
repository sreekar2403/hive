export {};

declare global {
  interface Window {
    /** Present only inside the Electron shell; absent in a plain browser tab. */
    electronAPI?: {
      platform: string;
      send: (channel: string, data: unknown) => void;
      on: (channel: string, callback: (...args: unknown[]) => void) => void;
    };
  }
}
