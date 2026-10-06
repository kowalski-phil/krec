// Paints the captured screen and a round webcam bubble onto one canvas, and hands back the
// canvas as a video stream for MediaRecorder. Only used when the webcam toggle is on;
// without the webcam the raw screen stream is recorded directly, which costs less CPU.

const FPS = 30
const BUBBLE_DIAMETER_AT_1920 = 220 // px, scaled with the output width
const MIN_BUBBLE_DIAMETER = 140
const RING_WIDTH = 3
const MARGIN_RATIO = 0.15 // gap to the frame edge, as a share of the bubble diameter

export interface Compositor {
  /** The composited video track to record. */
  track: MediaStreamTrack
  width: number
  height: number
  /** Frames actually drawn per second since the start (for diagnostics; target is 30). */
  averageFps(): number
  stop(): void
}

async function playHidden(track: MediaStreamTrack): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream([track])
  await video.play()
  return video
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

export async function startCompositor(screenTrack: MediaStreamTrack, webcamTrack: MediaStreamTrack): Promise<Compositor> {
  const [screen, webcam] = await Promise.all([playHidden(screenTrack), playHidden(webcamTrack)])

  // The canvas keeps the size of the first screen frame; if a captured window is resized
  // later, its frames are fitted inside it instead of changing the video size.
  const width = even(screen.videoWidth || screenTrack.getSettings().width || 1920)
  const height = even(screen.videoHeight || screenTrack.getSettings().height || 1080)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Canvas 2D is not available')

  const diameter = Math.max(MIN_BUBBLE_DIAMETER, Math.round((width * BUBBLE_DIAMETER_AT_1920) / 1920))
  const margin = Math.round(diameter * MARGIN_RATIO)
  const cx = width - margin - diameter / 2
  const cy = height - margin - diameter / 2
  const r = diameter / 2

  const draw = (): void => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)

    // Screen, letterboxed to the canvas if its shape changed.
    const sw = screen.videoWidth
    const sh = screen.videoHeight
    if (sw && sh) {
      const scale = Math.min(width / sw, height / sh)
      const dw = sw * scale
      const dh = sh * scale
      ctx.drawImage(screen, (width - dw) / 2, (height - dh) / 2, dw, dh)
    }

    // Webcam: centre square of the camera image, clipped to a circle.
    const ww = webcam.videoWidth
    const wh = webcam.videoHeight
    if (ww && wh) {
      const side = Math.min(ww, wh)
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(webcam, (ww - side) / 2, (wh - side) / 2, side, side, cx - r, cy - r, diameter, diameter)
      ctx.restore()

      ctx.beginPath()
      ctx.arc(cx, cy, r - RING_WIDTH / 2, 0, Math.PI * 2)
      ctx.lineWidth = RING_WIDTH
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
  }

  let frames = 0
  const startedAt = performance.now()
  const drawTimer = window.setInterval(() => {
    draw()
    frames++
  }, 1000 / FPS)
  draw()

  const track = canvas.captureStream(FPS).getVideoTracks()[0]

  return {
    track,
    width,
    height,
    averageFps: () => frames / Math.max(0.001, (performance.now() - startedAt) / 1000),
    stop() {
      window.clearInterval(drawTimer)
      track.stop()
      screen.srcObject = null
      webcam.srcObject = null
    }
  }
}
