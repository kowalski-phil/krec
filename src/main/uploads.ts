import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { HistoryItem, UploadUpdate } from '../shared/types'
import { assetUrl, CACHE_SHORT, newVideoId, putFile, putText, shareUrl, StorageError } from './aws'
import { copyLinkAndNotify, notify } from './notify'
import { renderSharePage } from './sharepage'
import { getAwsConfig, getHistoryItem, listHistory, updateHistoryItem } from './store'

const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] // up to 3 retries after the first try
const VIDEO_SHARE = 0.95 // the MP4 is ~95% of the bytes; thumbnail and page are the rest

const uploading = new Set<string>()

function broadcast(item: HistoryItem, percent: number | null = null): void {
  const update: UploadUpdate = { item, percent }
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
      const retryable = err instanceof StorageError && err.retryable
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err
      console.warn(`[upload] attempt ${attempt + 1} failed, retrying:`, (err as Error).message)
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}

/**
 * Uploads video, thumbnail and share page, then copies the link. The page goes last, so
 * the link only works once everything it needs is there. Safe to call again for a retry;
 * never throws.
 */
export async function startUpload(id: string): Promise<void> {
  if (uploading.has(id)) return
  const cfg = getAwsConfig()
  let item = getHistoryItem(id)
  if (!item) return
  if (!cfg) {
    update(id, { status: 'local', error: null })
    return
  }

  uploading.add(id)
  try {
    // A retry keeps the same id, so a link handed out earlier would still become valid.
    const remoteId = item.remoteId && item.remoteDomain === cfg.cdnDomain ? item.remoteId : newVideoId()
    item = update(id, { status: 'uploading', error: null, remoteId, remoteDomain: cfg.cdnDomain })
    broadcast(item, 0)

    const videoKey = `v/${remoteId}.mp4`
    const thumbKey = `v/${remoteId}.jpg`
    const pageKey = `v/${remoteId}`

    let lastPercent = 0
    await withRetries(() =>
      putFile(cfg, videoKey, item!.localPath, 'video/mp4', (fraction) => {
        const percent = Math.floor(fraction * VIDEO_SHARE * 100)
        if (percent !== lastPercent) broadcast(item!, (lastPercent = percent))
      })
    )
    await withRetries(() => putFile(cfg, thumbKey, item!.thumbnailPath, 'image/jpeg'))

    const url = shareUrl(cfg, remoteId)
    const page = renderSharePage({
      title: item.title,
      pageUrl: url,
      videoUrl: assetUrl(cfg, videoKey),
      thumbnailUrl: assetUrl(cfg, thumbKey),
      width: item.width,
      height: item.height,
      durationSec: item.durationSec,
      createdAt: new Date(item.createdAt)
    })
    await withRetries(() => putText(cfg, pageKey, page, 'text/html; charset=utf-8', CACHE_SHORT))

    item = update(id, { status: 'ready', shareUrl: url, uploadedAt: new Date().toISOString() })
    copyLinkAndNotify(url, item.title)
  } catch (err) {
    console.error('[upload] failed:', err)
    update(id, { status: 'failed', error: (err as Error).message })
    notify('Upload failed', 'The video is still saved on this PC. Open Krec to retry.')
  } finally {
    uploading.delete(id)
  }
}

/** On app start: uploads interrupted by quitting become retryable failures. */
export function resumeUploads(): void {
  for (const item of listHistory()) {
    if (item.status === 'uploading') {
      updateHistoryItem(item.id, { status: 'failed', error: 'Krec was closed during the upload.' })
    }
  }
}
