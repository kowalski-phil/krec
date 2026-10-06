// A screen or window the user can pick in the source picker.
export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string // data URL, empty when listed without thumbnails
  icon: string | null // data URL, windows only
}

// What the renderer reports when a recording starts, for the main-process log.
export interface RecordingInfo {
  mimeType: string
  width: number
  height: number
  frameRate: number
  hasAudio: boolean
}

// A finished, converted recording on disk. Upload continues in the background.
export interface RecordingResult {
  historyId: string
  path: string // the MP4
  durationSec: number
  /** False when no Bunny library is configured; the video then stays local. */
  willUpload: boolean
}

/**
 * uploading  -> creating the Bunny video or sending the file
 * processing -> uploaded, Bunny is queueing or encoding it
 * ready      -> Bunny finished encoding; the link was copied at this point
 * failed     -> upload failed, local file kept, can be retried
 * error      -> Bunny accepted the file but could not process it
 * local      -> no Bunny library configured, never uploaded
 */
export type HistoryStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'error' | 'local'

export interface HistoryItem {
  id: string
  title: string
  localPath: string
  thumbnailPath: string
  libraryId: string | null
  bunnyGuid: string | null
  shareUrl: string | null
  status: HistoryStatus
  error: string | null
  durationSec: number
  createdAt: string // ISO 8601
  uploadedAt?: string | null // ISO 8601, set when the PUT succeeds
}

// Pushed from main to every window whenever a history item changes.
export interface UploadUpdate {
  item: HistoryItem
  /** 0-100: upload progress while 'uploading', Bunny's encode progress while 'processing'. */
  percent: number | null
  /** Bunny's raw video status while 'processing' (0-3 = not finished yet), else null. */
  bunnyStatus: number | null
}

// Settings as the renderer sees them. The API key itself never leaves main.
export interface PublicSettings {
  libraryId: string
  hasApiKey: boolean
  micDeviceId: string // '' = Windows default
  saveDir: string
}

export interface SettingsUpdate {
  libraryId: string
  /** null keeps the stored key, '' removes it. */
  apiKey: string | null
  micDeviceId: string
  saveDir: string
}

export interface ValidationResult {
  ok: boolean
  message: string
}
