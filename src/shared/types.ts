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
