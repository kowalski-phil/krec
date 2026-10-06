import type {
  CaptureSource,
  HistoryItem,
  PublicSettings,
  RecordingInfo,
  RecordingResult,
  RecordingStats,
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
  recordingEnd(stats: RecordingStats): Promise<RecordingResult>
  /** Closes and deletes the file without converting or uploading it. */
  recordingCancel(): Promise<void>

  openSettings(): void
  closeSettings(): void
  getSettings(): Promise<PublicSettings>
  saveSettings(update: SettingsUpdate): Promise<ValidationResult>
  /** Tests an AWS setup code end to end. A null code tests the stored setup. */
  validateAws(setupCode: string | null): Promise<ValidationResult>
  chooseFolder(): Promise<string | null>
  /** The panel's Webcam toggle; remembered across restarts. */
  setWebcamEnabled(enabled: boolean): void

  openHistory(): void
  listHistory(): Promise<HistoryItem[]>
  /** Asks for confirmation, then deletes the local file and the online copy. */
  deleteRecording(historyId: string): Promise<ValidationResult>
  /** Fires when a recording is added to or removed from the history. */
  onHistoryChanged(callback: () => void): () => void

  /** Subscribes to upload progress and status changes. Returns an unsubscribe function. */
  onUploadUpdate(callback: (update: UploadUpdate) => void): () => void
  retryUpload(historyId: string): void

  showFile(path: string): void
  openPath(path: string): void
  /** Opens an https link in the default browser. */
  openExternal(url: string): void
  /** Starts an OS drag of a recording's MP4 (call from a dragstart handler). */
  startFileDrag(historyId: string): void
  /** Puts a recording's MP4 on the clipboard as a file, ready to paste into a web page. */
  copyVideoFile(historyId: string): Promise<ValidationResult>
  copyText(text: string): void
}

declare global {
  interface Window {
    krec: KrecApi
  }
}
