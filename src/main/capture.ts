import { BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { IPC } from '../shared/ipc'
import type { CaptureSource } from '../shared/types'

const THUMBNAIL_SIZE = { width: 320, height: 180 }

// The source picked in the picker, consumed by the next getDisplayMedia() call.
let pendingSource: { id: string; name: string } | null = null
let picker: BrowserWindow | null = null
let resolvePicker: ((chosen: boolean) => void) | null = null
let lastListed = new Map<string, string>() // source id -> name

// Without thumbnails the list returns almost instantly. With them, Windows tries to
// capture every window, and hidden system windows each stall about a second before
// failing, so the picker asks twice: names first, thumbnails second.
async function listSources(withThumbnails: boolean): Promise<CaptureSource[]> {
  const ownWindows = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: withThumbnails ? THUMBNAIL_SIZE : { width: 0, height: 0 },
    fetchWindowIcons: true
  })
  const screens = sources.filter((s) => s.id.startsWith('screen:'))
  const result: CaptureSource[] = sources
    .filter((s) => s.name.trim() !== '' && !ownWindows.has(s.id))
    // A window Windows could not capture for a thumbnail cannot be recorded either.
    .filter((s) => !withThumbnails || s.id.startsWith('screen:') || !s.thumbnail.isEmpty())
    .map((s) => {
      const kind = s.id.startsWith('screen:') ? 'screen' : 'window'
      return {
        id: s.id,
        name: kind === 'screen' && screens.length === 1 ? 'Entire screen' : s.name,
        kind,
        thumbnail: withThumbnails ? `data:image/jpeg;base64,${s.thumbnail.toJPEG(80).toString('base64')}` : '',
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
      }
    })
  lastListed = new Map(result.map((s) => [s.id, s.name]))
  return result
}

function finishPicking(id: string | null): void {
  const name = id ? lastListed.get(id) : undefined
  pendingSource = id && name ? { id, name } : null
  resolvePicker?.(pendingSource !== null)
  resolvePicker = null
  picker?.close()
}

export function registerCapture(createPicker: () => BrowserWindow): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const source = pendingSource
    pendingSource = null
    callback(source ? { video: source } : {})
  })

  ipcMain.handle(IPC.pickerOpen, () => {
    if (picker) {
      picker.focus()
      return false
    }
    pendingSource = null
    picker = createPicker()
    picker.on('closed', () => {
      picker = null
      resolvePicker?.(false)
      resolvePicker = null
    })
    return new Promise<boolean>((resolve) => {
      resolvePicker = resolve
    })
  })

  ipcMain.handle(IPC.pickerList, (_event, withThumbnails: boolean) => listSources(withThumbnails))
  ipcMain.on(IPC.pickerChoose, (_event, id: string | null) => finishPicking(id))
}
