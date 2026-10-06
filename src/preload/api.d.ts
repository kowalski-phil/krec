import type {
  CaptureSource,
  PublicSettings,
  RecordingInfo,
  RecordingResult,
  SettingsUpdate,
  UploadUpdate,
  ValidationResult
} from '../shared/types'

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
  /** Closes the file, converts it to MP4 and starts the upload in the background. */
  recordingEnd(): Promise<RecordingResult>
  /** Closes and deletes the file without converting or uploading it. */
  recordingCancel(): Promise<void>

  openSettings(): void
  closeSettings(): void
  getSettings(): Promise<PublicSettings>
  saveSettings(update: SettingsUpdate): Promise<ValidationResult>
  /** Tests an AWS setup code end to end. A null code tests the stored setup. */
  validateAws(setupCode: string | null): Promise<ValidationResult>
  chooseFolder(): Promise<string | null>

  /** Subscribes to upload progress and status changes. Returns an unsubscribe function. */
  onUploadUpdate(callback: (update: UploadUpdate) => void): () => void
  retryUpload(historyId: string): void

  showFile(path: string): void
  openPath(path: string): void
  copyText(text: string): void
}

declare global {
  interface Window {
    krec: KrecApi
  }
}
