import { createWriteStream, mkdirSync, type WriteStream } from 'fs'
import { join } from 'path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { RecordingInfo } from '../shared/types'

let current: { file: WriteStream; path: string; window: BrowserWindow | null } | null = null

export function recordingsDir(): string {
  return join(app.getPath('videos'), 'Krec')
}

// "Krec 2026-10-06 14-32-05" in local time.
function recordingName(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `Krec ${day} ${time}`
}

export function registerRecorderIpc(): void {
  ipcMain.handle(IPC.recordingBegin, (event, info: RecordingInfo) => {
    if (current) throw new Error('A recording is already in progress')
    const dir = recordingsDir()
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

  ipcMain.handle(IPC.recordingEnd, async () => {
    if (!current) throw new Error('No recording in progress')
    const { file, path, window } = current
    current = null
    if (window && !window.isDestroyed()) window.setContentProtection(false)
    await new Promise<void>((resolve, reject) => {
      if (file.errored) return reject(file.errored)
      file.once('error', reject)
      file.end(resolve)
    })
    console.log('[recorder] saved', path)
    return path
  })
}
