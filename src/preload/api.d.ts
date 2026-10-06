// The small typed API the preload exposes to every renderer as `window.krec`.
export interface KrecApi {
  closePanel(): void
  minimizePanel(): void
}

declare global {
  interface Window {
    krec: KrecApi
  }
}
