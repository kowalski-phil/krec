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
  /** False when AWS is not set up; the video then stays local. */
  willUpload: boolean
}

/**
 * uploading -> sending video, thumbnail and share page to S3
 * ready     -> uploaded; the link works and was copied
 * failed    -> upload failed, local file kept, can be retried
 * local     -> AWS not set up, never uploaded
 */
export type HistoryStatus = 'uploading' | 'ready' | 'failed' | 'local'

export interface HistoryItem {
  id: string
  title: string
  localPath: string
  thumbnailPath: string
  width: number
  height: number
  durationSec: number
  createdAt: string // ISO 8601
  status: HistoryStatus
  error: string | null
  /** Random id in the share URL and S3 keys (v/<id>, v/<id>.mp4, v/<id>.jpg). */
  remoteId: string | null
  /** CloudFront domain the video was uploaded behind, kept for deleting it later. */
  remoteDomain: string | null
  shareUrl: string | null
  uploadedAt: string | null // ISO 8601
}

// Pushed from main to every window whenever a history item changes.
export interface UploadUpdate {
  item: HistoryItem
  /** 0-100 while status is 'uploading'. */
  percent: number | null
}

// What the renderer may know about the AWS setup. The secret key never leaves main.
export interface AwsSummary {
  region: string
  bucket: string
  cdnDomain: string
  accessKeyHint: string // last 4 characters of the access key id
}

export interface PublicSettings {
  aws: AwsSummary | null
  micDeviceId: string // '' = Windows default
  saveDir: string
}

export interface SettingsUpdate {
  /** A "krec1:" setup code from scripts/aws-setup.sh; null keeps the current AWS setup. */
  awsSetupCode: string | null
  micDeviceId: string
  saveDir: string
}

export interface ValidationResult {
  ok: boolean
  message: string
}
