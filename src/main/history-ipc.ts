import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { pathToFileURL } from 'url'
import { BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { IPC } from '../shared/ipc'
import type { ValidationResult } from '../shared/types'
import { deleteVideo } from './aws'
import { getAwsConfig, getHistoryItem, listHistory, removeHistoryItem } from './store'

// Thumbnails live in %APPDATA%\Krec\thumbnails. The sandboxed renderer cannot read files,
// so it asks for krec-thumb://<history id>; only thumbnails of known history items are served.
const THUMB_SCHEME = 'krec-thumb'

/** Must run before the app is ready. */
export function registerThumbnailScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: THUMB_SCHEME, privileges: { standard: true, secure: true } }])
}

export function broadcastHistoryChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.historyChanged)
}

async function deleteRecording(win: BrowserWindow | null, id: string): Promise<ValidationResult> {
  const item = getHistoryItem(id)
  if (!item) return { ok: true, message: '' }
  if (item.status === 'uploading') return { ok: false, message: 'Wait until the upload has finished.' }

  const cfg = getAwsConfig()
  const online = item.remoteId !== null && item.shareUrl !== null
  const canDeleteOnline = online && cfg !== null && cfg.cdnDomain === item.remoteDomain
  const detail = !online
    ? 'The video file on this PC will be deleted.'
    : canDeleteOnline
      ? 'The video file on this PC and the online copy will be deleted. The share link stops working for everyone.'
      : 'The file on this PC will be deleted. The online copy was uploaded with a different AWS setup, so Krec cannot remove it.'

  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Delete recording',
    message: `Delete "${item.title}"?`,
    detail,
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  if (response !== 0) return { ok: true, message: '' }

  // Online first: if that fails, nothing local is touched and the user can try again.
  if (canDeleteOnline && item.remoteId) {
    try {
      await deleteVideo(cfg, item.remoteId)
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }
  await rm(item.localPath, { force: true })
  await rm(item.thumbnailPath, { force: true })
  removeHistoryItem(id)
  broadcastHistoryChanged()
  return { ok: true, message: 'Deleted.' }
}

/**
 * Puts the MP4 on the clipboard as a file (Windows "file drop list"), the same thing
 * Explorer does on Ctrl+C, so it can be pasted into a web page such as a Skool post.
 * Electron's clipboard API cannot write that format, so PowerShell's Set-Clipboard does it.
 */
function copyFileToClipboard(path: string): Promise<ValidationResult> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:KREC_FILE'],
      { env: { ...process.env, KREC_FILE: path }, windowsHide: true, timeout: 15_000 },
      (err) => resolve(err ? { ok: false, message: `Could not copy the file: ${err.message}` } : { ok: true, message: '' })
    )
  })
}

export function registerHistoryIpc(openHistory: () => void, appIconPath: () => string): void {
  protocol.handle(THUMB_SCHEME, (request) => {
    const item = getHistoryItem(new URL(request.url).hostname)
    if (!item) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(item.thumbnailPath).toString())
  })

  ipcMain.on(IPC.historyOpen, () => openHistory())
  ipcMain.handle(IPC.historyList, () => listHistory())
  ipcMain.handle(IPC.historyDelete, (event, id: string) => deleteRecording(BrowserWindow.fromWebContents(event.sender), id))
  // Drag a recording out of Krec (into Skool, a chat, a folder). The renderer passes an id,
  // never a path, so it can only drag Krec's own recordings.
  ipcMain.on(IPC.fileStartDrag, (event, id: string) => {
    const item = getHistoryItem(id)
    if (!item || !existsSync(item.localPath)) return
    const thumb = nativeImage.createFromPath(item.thumbnailPath)
    const icon = thumb.isEmpty() ? nativeImage.createFromPath(appIconPath()) : thumb.resize({ width: 160 })
    event.sender.startDrag({ file: item.localPath, icon })
  })

  ipcMain.handle(IPC.fileCopy, async (_event, id: string): Promise<ValidationResult> => {
    const item = getHistoryItem(id)
    if (!item || !existsSync(item.localPath)) return { ok: false, message: 'The video file is no longer on this PC.' }
    return copyFileToClipboard(item.localPath)
  })

  // Only share links (https) are opened, never arbitrary schemes from the renderer.
  ipcMain.on(IPC.openExternal, (_event, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
  })
}
