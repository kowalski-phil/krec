import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { request } from 'https'
import type { BunnyCredentials } from './store'

// Bunny Stream HTTP API: https://bunny.net/docs/stream/http-api
const API = 'https://video.bunnycdn.com'
const IDLE_TIMEOUT_MS = 60_000

export class BunnyError extends Error {
  constructor(
    message: string,
    readonly status: number | null, // null = network error, no HTTP response
    readonly retryable: boolean
  ) {
    super(message)
  }
}

function friendlyError(status: number, body: string): BunnyError {
  const retryable = status >= 500 || status === 429
  if (status === 401) return new BunnyError('Bunny rejected the API key. Check the key in Settings.', status, false)
  if (status === 404) return new BunnyError('Bunny library or video not found. Check the Library ID.', status, false)
  return new BunnyError(`Bunny returned HTTP ${status}: ${body.slice(0, 200)}`, status, retryable)
}

async function call<T>(creds: BunnyCredentials, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}/library/${encodeURIComponent(creds.libraryId)}${path}`, {
      method,
      headers: {
        AccessKey: creds.apiKey,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(IDLE_TIMEOUT_MS)
    })
  } catch (err) {
    throw new BunnyError(`Could not reach Bunny: ${(err as Error).message}`, null, true)
  }
  const text = await res.text()
  if (!res.ok) throw friendlyError(res.status, text)
  return (text ? JSON.parse(text) : {}) as T
}

/** Cheapest authenticated call: list one video. Throws a BunnyError explaining what is wrong. */
export async function validateCredentials(creds: BunnyCredentials): Promise<void> {
  await call(creds, 'GET', '/videos?page=1&itemsPerPage=1')
}

export async function createVideo(creds: BunnyCredentials, title: string): Promise<string> {
  const video = await call<{ guid: string }>(creds, 'POST', '/videos', { title })
  return video.guid
}

/**
 * Streams the file from disk as the raw PUT body (not multipart, not base64), so the
 * whole video is never held in memory. `onProgress` gets 0..1 as bytes are sent.
 */
export async function uploadVideo(
  creds: BunnyCredentials,
  guid: string,
  filePath: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  const size = (await stat(filePath)).size
  const url = `${API}/library/${encodeURIComponent(creds.libraryId)}/videos/${encodeURIComponent(guid)}`

  await new Promise<void>((resolve, reject) => {
    const file = createReadStream(filePath)
    const req = request(url, {
      method: 'PUT',
      headers: {
        AccessKey: creds.apiKey,
        accept: 'application/json',
        'content-type': 'application/octet-stream',
        'content-length': size
      }
    })
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error('Upload stalled for 60 seconds')))
    req.on('error', (err) => {
      file.destroy()
      reject(new BunnyError(`Upload interrupted: ${err.message}`, null, true))
    })
    req.on('response', (res) => {
      let body = ''
      res.on('data', (d: Buffer) => (body += d.toString()))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) resolve()
        else reject(friendlyError(status, body))
      })
    })

    let sent = 0
    file.on('data', (chunk) => {
      sent += chunk.length
      onProgress(sent / size)
    })
    file.on('error', (err) => req.destroy(err))
    file.pipe(req)
  })
}

export interface VideoStatus {
  /** 0 Created, 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5 Error, 6 UploadFailed, 7/8 JIT. */
  status: number
  encodeProgress: number
}

export async function getVideoStatus(creds: BunnyCredentials, guid: string): Promise<VideoStatus> {
  return call<VideoStatus>(creds, 'GET', `/videos/${encodeURIComponent(guid)}`)
}

export async function deleteVideo(creds: BunnyCredentials, guid: string): Promise<void> {
  await call(creds, 'DELETE', `/videos/${encodeURIComponent(guid)}`)
}

/** Full-page player anyone can open; carries Open Graph tags so chat apps unfurl it. */
export function playUrl(libraryId: string, guid: string): string {
  return `https://player.mediadelivery.net/play/${libraryId}/${guid}`
}
