import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { HistoryItem, UploadUpdate } from '../shared/types'
import { BunnyError, createVideo, getVideoStatus, playUrl, uploadVideo } from './bunny'
import { copyLinkAndNotify, notify } from './notify'
import { getCredentials, getHistoryItem, listHistory, updateHistoryItem, type BunnyCredentials } from './store'

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] // up to 3 retries after the first try
const POLL_INTERVAL_MS = 5_000 // also how often the panel's "waiting in queue" line refreshes
const BUNNY_FINISHED = 4
const BUNNY_FAILED = [5, 6] // Error, UploadFailed

const uploading = new Set<string>()
const polling = new Map<string, NodeJS.Timeout>()

function broadcast(item: HistoryItem, percent: number | null = null, bunnyStatus: number | null = null): void {
  const update: UploadUpdate = { item, percent, bunnyStatus }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.uploadUpdate, update)
}

function update(id: string, patch: Partial<HistoryItem>): HistoryItem {
  const item = updateHistoryItem(id, patch)
  broadcast(item)
  return item
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function withRetries<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (err) {
      const retryable = err instanceof BunnyError && err.retryable
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err
      console.warn(`[upload] attempt ${attempt + 1} failed, retrying:`, (err as Error).message)
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}

/** Uploads a history item to Bunny. Safe to call again for a retry; never throws. */
export async function startUpload(id: string): Promise<void> {
  if (uploading.has(id)) return
  const creds = getCredentials()
  let item = getHistoryItem(id)
  if (!item) return
  if (!creds) {
    update(id, { status: 'local', error: null })
    return
  }

  uploading.add(id)
  try {
    // A retry after a failed PUT reuses the video Bunny already created, if it is the same library.
    let guid = item.libraryId === creds.libraryId ? item.bunnyGuid : null
    item = update(id, { status: 'uploading', error: null, libraryId: creds.libraryId, bunnyGuid: guid })
    broadcast(item, 0)

    if (!guid) {
      guid = await withRetries(() => createVideo(creds, item!.title))
      item = update(id, { bunnyGuid: guid })
    }

    let lastPercent = 0
    await withRetries(() =>
      uploadVideo(creds, guid!, item!.localPath, (fraction) => {
        const percent = Math.floor(fraction * 100)
        if (percent !== lastPercent) broadcast(item!, (lastPercent = percent))
      })
    )

    // The link is only copied once Bunny has finished processing; until then it shows a "processing" page.
    const shareUrl = playUrl(creds.libraryId, guid)
    item = update(id, { status: 'processing', shareUrl, uploadedAt: new Date().toISOString() })
    pollUntilProcessed(id, creds)
  } catch (err) {
    console.error('[upload] failed:', err)
    update(id, { status: 'failed', error: (err as Error).message })
    notify('Upload failed', 'The video is still saved on this PC. Open Krec to retry.')
  } finally {
    uploading.delete(id)
  }
}

function pollUntilProcessed(id: string, creds: BunnyCredentials): void {
  if (polling.has(id)) return
  let lastSeen = ''
  const tick = async (): Promise<void> => {
    const item = getHistoryItem(id)
    if (!item?.bunnyGuid || item.status !== 'processing') return void polling.delete(id)
    try {
      const { status, encodeProgress } = await getVideoStatus(creds, item.bunnyGuid)
      const seen = `status ${status}, encode ${encodeProgress}%`
      if (seen !== lastSeen) console.log(`[upload] ${item.title}: Bunny ${(lastSeen = seen)}`)
      if (status === BUNNY_FINISHED) {
        const ready = update(id, { status: 'ready' })
        if (ready.shareUrl) copyLinkAndNotify(ready.shareUrl, ready.title)
        return void polling.delete(id)
      }
      if (BUNNY_FAILED.includes(status)) {
        update(id, { status: 'error', error: `Bunny could not process the video (status ${status}).` })
        notify('Bunny could not process the video', 'The video is still saved on this PC.')
        return void polling.delete(id)
      }
      broadcast(item, encodeProgress, status)
    } catch (err) {
      // Network hiccup or similar: keep polling, the video is already uploaded.
      console.warn('[upload] status check failed:', (err as Error).message)
    }
    polling.set(id, setTimeout(tick, POLL_INTERVAL_MS))
  }
  polling.set(id, setTimeout(tick, POLL_INTERVAL_MS))
}

/**
 * On app start: uploads interrupted by quitting become retryable failures, and videos
 * still processing on Bunny are polled again.
 */
export function resumeUploads(): void {
  const creds = getCredentials()
  for (const item of listHistory()) {
    if (item.status === 'uploading') {
      updateHistoryItem(item.id, { status: 'failed', error: 'Krec was closed during the upload.' })
    } else if (item.status === 'processing' && creds && item.libraryId === creds.libraryId) {
      pollUntilProcessed(item.id, creds)
    }
  }
}

export function stopPolling(): void {
  for (const timer of polling.values()) clearTimeout(timer)
  polling.clear()
}
