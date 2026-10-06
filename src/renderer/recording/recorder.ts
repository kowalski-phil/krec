// MediaRecorder lifecycle: grabs the picked screen/window plus the mic, records WebM,
// and streams a chunk to main every second so the renderer never holds the whole file.

import type { RecordingResult } from '../../shared/types'

const CHUNK_MS = 1000
const FRAME_RATE = 30
const VIDEO_BITS_PER_SECOND = 6_000_000
const AUDIO_BITS_PER_SECOND = 128_000

// First supported wins. H.264 is usually hardware-encoded, so it is the cheapest on CPU.
const MIME_CANDIDATES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export interface Recording {
  /** Null when no microphone could be opened; the video is then silent. */
  mic: MediaStreamTrack | null
  /** Starts writing frames. Called after the countdown, so it is not in the video. */
  start(): void
  pause(): void
  resume(): void
  readonly paused: boolean
  /** Recorded time so far, excluding pauses. */
  elapsedMs(): number
  /** Stops recording, flushes and converts the file, and resolves with the MP4. */
  stop(): Promise<RecordingResult>
  /** Throws the recording away (e.g. countdown cancelled); nothing is kept on disk. */
  cancel(): Promise<void>
}

/** The mic chosen in Settings, or the Windows default if none is set or it is unplugged. */
async function openMicrophone(): Promise<MediaStream | null> {
  const { micDeviceId } = await window.krec.getSettings()
  if (micDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micDeviceId } } })
    } catch (err) {
      console.warn('Chosen microphone unavailable, falling back to the Windows default', err)
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    console.warn('Microphone unavailable, recording without audio', err)
    return null
  }
}

/**
 * Opens the source chosen in the picker, the mic and the file on disk, ready to start().
 * Doing this before the countdown means recording begins the instant it ends.
 * `onSourceEnded` fires when the captured window closes by itself.
 */
export async function prepareRecording(onSourceEnded: () => void): Promise<Recording> {
  // Capped at 1920x1080 (aspect ratio kept) to match the 1080p output and save CPU.
  const screen = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: FRAME_RATE, width: { max: 1920 }, height: { max: 1080 } },
    audio: false
  })
  const mic = await openMicrophone()

  const tracks = [...screen.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])]
  const stream = new MediaStream(tracks)
  const stopTracks = (): void => tracks.forEach((t) => t.stop())

  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND
  })

  const settings = screen.getVideoTracks()[0].getSettings()
  try {
    await window.krec.recordingBegin({
      mimeType: recorder.mimeType,
      width: settings.width ?? 0,
      height: settings.height ?? 0,
      frameRate: settings.frameRate ?? 0,
      hasAudio: mic !== null
    })
  } catch (err) {
    stopTracks()
    throw err
  }

  // Blob.arrayBuffer() is async, so chain the sends to keep chunks in order.
  let pending = Promise.resolve()
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    const blob = event.data
    pending = pending.then(async () => window.krec.recordingChunk(await blob.arrayBuffer()))
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  screen.getVideoTracks()[0].addEventListener('ended', onSourceEnded)

  // Elapsed time = finished segments + the running one. A segment ends at each pause.
  let doneMs = 0
  let segmentStart: number | null = null

  const finish = async (): Promise<void> => {
    if (recorder.state !== 'inactive') {
      recorder.stop()
      await stopped
    }
    await pending
    stopTracks()
  }

  return {
    mic: mic?.getAudioTracks()[0] ?? null,
    start() {
      recorder.start(CHUNK_MS)
      segmentStart = performance.now()
    },
    pause() {
      if (recorder.state !== 'recording' || segmentStart === null) return
      recorder.pause()
      doneMs += performance.now() - segmentStart
      segmentStart = null
    },
    resume() {
      if (recorder.state !== 'paused') return
      recorder.resume()
      segmentStart = performance.now()
    },
    get paused() {
      return recorder.state === 'paused'
    },
    elapsedMs() {
      return doneMs + (segmentStart === null ? 0 : performance.now() - segmentStart)
    },
    async stop() {
      await finish()
      return window.krec.recordingEnd()
    },
    async cancel() {
      await finish()
      await window.krec.recordingCancel()
    }
  }
}
