import { randomUUID } from 'crypto'
import { createWriteStream, mkdirSync, type WriteStream } from 'fs'
import { rm } from 'fs/promises'
import { basename, extname, join } from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { RecordingInfo, RecordingResult, RecordingStats } from '../shared/types'
import { convertRecording } from './convert'
import { broadcastHistoryChanged } from './history-ipc'
import { addHistoryItem, getAwsConfig, publicSettings } from './store'
import { startUpload } from './uploads'

let current: { file: WriteStream; path: string; window: BrowserWindow | null } | null = null

// "Krec 2026-10-06 14-32-05" in local time.
function recordingName(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `Krec ${day} ${time}`
}

/** Flushes and closes the recording file, lifts the capture exclusion, returns the path. */
async function closeCurrent(): Promise<string> {
  if (!current) throw new Error('No recording in progress')
  const { file, path, window } = current
  current = null
  if (window && !window.isDestroyed()) window.setContentProtection(false)
  await new Promise<void>((resolve, reject) => {
    if (file.errored) return reject(file.errored)
    file.once('error', reject)
    file.end(resolve)
  })
  return path
}

export function registerRecorderIpc(): void {
  ipcMain.handle(IPC.recordingBegin, (event, info: RecordingInfo) => {
    if (current) throw new Error('A recording is already in progress')
    const dir = publicSettings().saveDir
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${recordingName()}.webm`)
    const file = createWriteStream(path)
    file.on('error', (err) => console.error('[recorder] write failed:', err))

    // Keep the recording window (the panel) out of its own video.
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setContentProtection(true)

    current = { file, path, window }
    console.log('[recorder] started', path, info)
  })

  ipcMain.on(IPC.recordingChunk, (_event, data: ArrayBuffer) => {
    current?.file.write(Buffer.from(data))
  })

  ipcMain.handle(IPC.recordingCancel, async () => {
    const path = await closeCurrent()
    await rm(path, { force: true })
    console.log('[recorder] cancelled', path)
  })

  ipcMain.handle(IPC.recordingEnd, async (_event, stats: RecordingStats): Promise<RecordingResult> => {
    const path = await closeCurrent()
    console.log('[recorder] saved', path, stats)

    const converted = await convertRecording(path)
    // The MP4 is the keeper; the WebM is only kept if conversion fails (it throws above).
    await rm(path, { force: true })
    console.log('[recorder] converted', converted)

    const id = randomUUID()
    addHistoryItem({
      id,
      title: basename(converted.mp4Path, extname(converted.mp4Path)),
      localPath: converted.mp4Path,
      thumbnailPath: converted.thumbnailPath,
      width: converted.width,
      height: converted.height,
      durationSec: converted.durationSec,
      createdAt: new Date().toISOString(),
      status: 'local',
      error: null,
      remoteId: null,
      remoteDomain: null,
      shareUrl: null,
      uploadedAt: null
    })
    broadcastHistoryChanged()
    const willUpload = getAwsConfig() !== null
    // Start after this reply is sent, so the panel knows the id before progress arrives.
    setImmediate(() => void startUpload(id))

    return { historyId: id, path: converted.mp4Path, durationSec: converted.durationSec, willUpload }
  })
}
