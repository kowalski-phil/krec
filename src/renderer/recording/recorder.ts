// MediaRecorder lifecycle: grabs the picked screen/window, the mic and (optionally) the
// webcam, records WebM, and streams a chunk to main every second so the renderer never
// holds the whole file.

import type { RecordingResult, RecordingStats } from '../../shared/types'
import { startCompositor, type Compositor } from './compositor'

const CHUNK_MS = 1000
const FRAME_RATE = 30
const VIDEO_BITS_PER_SECOND = 6_000_000
const AUDIO_BITS_PER_SECOND = 128_000

// First supported wins. H.264 is usually hardware-encoded, so it is the cheapest on CPU.
const MIME_CANDIDATES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export interface Recording {
  /** Null when no microphone could be opened; the video is then silent. */
  mic: MediaStreamTrack | null
  /** Whether the webcam bubble is in the video (toggle on and a camera could be opened). */
  hasWebcam: boolean
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
async function openMicrophone(micDeviceId: string): Promise<MediaStream | null> {
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

/** The camera chosen in Settings, falling back to any camera. Null if none can be opened. */
async function openWebcam(webcamDeviceId: string): Promise<MediaStreamTrack | null> {
  const size = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: FRAME_RATE } }
  const attempts: MediaTrackConstraints[] = webcamDeviceId
    ? [{ ...size, deviceId: { exact: webcamDeviceId } }, size]
    : [size]
  for (const video of attempts) {
    try {
      return (await navigator.mediaDevices.getUserMedia({ video, audio: false })).getVideoTracks()[0]
    } catch (err) {
      console.warn('Webcam unavailable', video, err)
    }
  }
  return null
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
  const screenTrack = screen.getVideoTracks()[0]
  const settings = await window.krec.getSettings()
  const mic = await openMicrophone(settings.micDeviceId)
  const webcam = settings.webcamEnabled ? await openWebcam(settings.webcamDeviceId) : null

  // With the webcam on, record a canvas that paints screen + bubble; otherwise the raw screen.
  let compositor: Compositor | null = null
  if (webcam) {
    try {
      compositor = await startCompositor(screenTrack, webcam)
    } catch (err) {
      webcam.stop()
      screenTrack.stop()
      mic?.getTracks().forEach((t) => t.stop())
      throw err
    }
  }

  const sources = [screenTrack, ...(webcam ? [webcam] : []), ...(mic?.getAudioTracks() ?? [])]
  const recorded = [compositor?.track ?? screenTrack, ...(mic?.getAudioTracks() ?? [])]
  const stream = new MediaStream(recorded)
  const stopTracks = (): void => {
    compositor?.stop()
    sources.forEach((t) => t.stop())
  }

  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND
  })

  const screenSettings = screenTrack.getSettings()
  try {
    await window.krec.recordingBegin({
      mimeType: recorder.mimeType,
      width: compositor?.width ?? screenSettings.width ?? 0,
      height: compositor?.height ?? screenSettings.height ?? 0,
      frameRate: screenSettings.frameRate ?? 0,
      hasAudio: mic !== null,
      hasWebcam: compositor !== null
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

  screenTrack.addEventListener('ended', onSourceEnded)

  // Elapsed time = finished segments + the running one. A segment ends at each pause.
  let doneMs = 0
  let segmentStart: number | null = null

  const finish = async (): Promise<RecordingStats> => {
    const stats: RecordingStats = { compositorFps: compositor ? Math.round(compositor.averageFps() * 10) / 10 : null }
    if (recorder.state !== 'inactive') {
      recorder.stop()
      await stopped
    }
    await pending
    stopTracks()
    return stats
  }

  return {
    mic: mic?.getAudioTracks()[0] ?? null,
    hasWebcam: compositor !== null,
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
      return window.krec.recordingEnd(await finish())
    },
    async cancel() {
      await finish()
      await window.krec.recordingCancel()
    }
  }
}
