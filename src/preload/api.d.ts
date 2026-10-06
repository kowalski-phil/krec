import type { CaptureSource, RecordingInfo } from '../shared/types'

// The small typed API the preload exposes to every renderer as `window.krec`.
export interface KrecApi {
  closePanel(): void
  minimizePanel(): void

  /** Opens the source picker. Resolves true once a source is chosen, false on cancel. */
  pickSource(): Promise<boolean>
  /** Without thumbnails this is fast; with them it can take a few seconds. */
  listSources(withThumbnails: boolean): Promise<CaptureSource[]>
  chooseSource(id: string | null): void

  /** Opens a new recording file on disk. Must resolve before chunks are sent. */
  recordingBegin(info: RecordingInfo): Promise<void>
  recordingChunk(data: ArrayBuffer): void
  /** Closes the file and resolves with its full path. */
  recordingEnd(): Promise<string>

  showFile(path: string): void
}

declare global {
  interface Window {
    krec: KrecApi
  }
}
