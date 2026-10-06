import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync } from 'fs'
import { basename, extname, join } from 'path'
import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'

const MAX_WIDTH = 1920
const FRAME_RATE = 30
const THUMBNAIL_WIDTH = 640

const running = new Set<ChildProcess>()

// In the installed app the binary lives in app.asar.unpacked, not inside the archive.
function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('No FFmpeg binary for this platform')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

/** Runs FFmpeg and resolves with its log output (FFmpeg writes everything to stderr). */
function ffmpeg(args: string[], allowFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', ...args], { windowsHide: true })
    running.add(child)
    let log = ''
    child.stderr.on('data', (d: Buffer) => {
      log += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      running.delete(child)
      if (code === 0 || allowFailure) resolve(log)
      else reject(new Error(`FFmpeg failed (exit ${code}): ${log.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
}

interface ProbeResult {
  width: number
  height: number
  durationSec: number | null
}

// `ffmpeg -i file` with no output prints the stream info and exits with an error; that is expected.
async function probe(path: string): Promise<ProbeResult> {
  const log = await ffmpeg(['-i', path], true)
  const video = log.match(/Video: .*?, (\d{2,5})x(\d{2,5})/)
  if (!video) throw new Error(`No video stream found in ${basename(path)}`)
  const d = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
  return {
    width: Number(video[1]),
    height: Number(video[2]),
    durationSec: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null
  }
}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

export interface ConvertResult {
  mp4Path: string
  thumbnailPath: string
  durationSec: number
}

/**
 * WebM (H.264/VP8 + Opus) -> MP4 (H.264 + AAC), max 1920 wide, constant 30 fps, with
 * the index at the front so it streams and seeks. Also writes a JPEG thumbnail.
 */
export async function convertRecording(webmPath: string): Promise<ConvertResult> {
  const name = basename(webmPath, extname(webmPath))
  const mp4Path = join(webmPath, '..', `${name}.mp4`)
  const thumbDir = join(app.getPath('userData'), 'thumbnails')
  mkdirSync(thumbDir, { recursive: true })
  const thumbnailPath = join(thumbDir, `${name}.jpg`)

  // The output frame size is fixed from the first frame. If a captured window is
  // resized mid-recording, later frames are fitted inside it instead of breaking the encoder.
  const src = await probe(webmPath)
  const width = even(Math.min(MAX_WIDTH, src.width))
  const height = even((src.height * width) / src.width)
  const fit =
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`

  await ffmpeg([
    '-y',
    '-i', webmPath,
    '-vf', fit,
    '-fps_mode', 'cfr',
    '-r', String(FRAME_RATE),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    mp4Path
  ])

  const durationSec = (await probe(mp4Path)).durationSec ?? 0
  await ffmpeg([
    '-y',
    '-ss', String(Math.min(1, durationSec / 2)),
    '-i', mp4Path,
    '-frames:v', '1',
    '-vf', `scale=${THUMBNAIL_WIDTH}:-2`,
    '-q:v', '3',
    thumbnailPath
  ])

  return { mp4Path, thumbnailPath, durationSec }
}

/** Kills any conversion still running, so no FFmpeg process outlives the app. */
export function killConversions(): void {
  for (const child of running) child.kill()
}
