import type { HistoryItem, UploadUpdate } from '../../shared/types'
import { startRecording, type Recording } from '../recording/recorder'
import { micName } from '../shared/mic'

type PanelState = 'idle' | 'picking' | 'recording' | 'saving'

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el as T
}

const panel = document.querySelector('.panel') as HTMLElement
const mainBtn = byId<HTMLButtonElement>('btn-main')
const mainLabel = byId('main-label')
const statusText = byId('status-text')
const actionBtn = byId<HTMLButtonElement>('btn-status-action')

let state: PanelState = 'idle'
let recording: Recording | null = null
let lastItemId: string | null = null // the most recent recording, whose upload the status line follows
let statusAction: (() => void) | null = null

function setStatus(text: string, action?: { label: string; run: () => void }, tooltip = ''): void {
  statusText.textContent = text
  statusText.title = tooltip || text
  actionBtn.hidden = !action
  actionBtn.textContent = action?.label ?? ''
  statusAction = action?.run ?? null
}

function setState(next: PanelState, status = ''): void {
  state = next
  panel.dataset.state = next
  mainLabel.textContent = next === 'recording' ? 'Stop' : 'Record'
  mainBtn.disabled = next === 'picking' || next === 'saving'
  setStatus(status)
}

// Bunny status 3 = transcoding; below that the video is still queued.
const BUNNY_TRANSCODING = 3

function minutesSince(iso: string | null | undefined): number {
  return iso ? Math.floor((Date.now() - Date.parse(iso)) / 60_000) : 0
}

function showUpload(item: HistoryItem, percent: number | null, bunnyStatus: number | null): void {
  const copy = (label: string): { label: string; run: () => void } => ({
    label,
    run: () => item.shareUrl && window.krec.copyText(item.shareUrl)
  })
  const showFile = { label: 'Show file', run: () => window.krec.showFile(item.localPath) }
  switch (item.status) {
    case 'uploading':
      return setStatus(percent === null ? 'Uploading…' : `Uploading… ${percent}%`)
    case 'processing': {
      const encoding = (bunnyStatus ?? 0) >= BUNNY_TRANSCODING || (percent ?? 0) > 0
      const mins = minutesSince(item.uploadedAt ?? item.createdAt)
      const text = encoding
        ? `Bunny encoding… ${percent ?? 0}%`
        : `In Bunny's queue${mins >= 1 ? ` · ${mins} min` : '…'}`
      return setStatus(text, copy('Copy link now'), 'Krec copies the link and notifies you when Bunny is done.')
    }
    case 'ready':
      return setStatus('Ready ✓ Link copied', copy('Copy again'))
    case 'failed':
      return setStatus('Upload failed.', { label: 'Retry', run: () => window.krec.retryUpload(item.id) }, item.error ?? '')
    case 'error':
      return setStatus('Bunny could not process it.', showFile, item.error ?? '')
    case 'local':
      return setStatus('Saved locally (Bunny not set up).', showFile)
  }
}

window.krec.onUploadUpdate(({ item, percent, bunnyStatus }: UploadUpdate) => {
  // After a restart, follow whichever video is still uploading or processing.
  lastItemId ??= item.id
  if (item.id === lastItemId && state === 'idle') showUpload(item, percent, bunnyStatus)
})

async function record(): Promise<void> {
  setState('picking', 'Choose what to record…')
  const chosen = await window.krec.pickSource()
  if (!chosen) return setState('idle')

  try {
    recording = await startRecording(() => void stop())
  } catch (err) {
    recording = null
    return setState('idle', `Could not start: ${(err as Error).message}`)
  }
  setState('recording', micStatus(recording.mic))
  // A muted track means the device delivers no sound at all (e.g. a disconnected virtual mic).
  const showMic = (): void => {
    if (state === 'recording' && recording) statusText.textContent = micStatus(recording.mic)
  }
  recording.mic?.addEventListener('mute', showMic)
  recording.mic?.addEventListener('unmute', showMic)
}

function micStatus(mic: MediaStreamTrack | null): string {
  if (!mic) return 'Recording without microphone'
  const name = micName(mic.label)
  return mic.muted ? `No sound from mic: ${name}` : `Recording · ${name}`
}

async function stop(): Promise<void> {
  if (state !== 'recording' || !recording) return
  const current = recording
  recording = null
  setState('saving', 'Saving…')
  try {
    const result = await current.stop()
    lastItemId = result.historyId
    setState('idle', result.willUpload ? 'Uploading…' : '')
    if (!result.willUpload) {
      setStatus('Saved locally (Bunny not set up).', {
        label: 'Show file',
        run: () => window.krec.showFile(result.path)
      })
    }
  } catch (err) {
    setState('idle', `Save failed: ${(err as Error).message}`)
  }
}

mainBtn.addEventListener('click', () => {
  if (state === 'idle') void record()
  else if (state === 'recording') void stop()
})
actionBtn.addEventListener('click', () => statusAction?.())
byId('btn-settings').addEventListener('click', () => window.krec.openSettings())
byId('btn-close').addEventListener('click', () => window.krec.closePanel())
byId('btn-minimize').addEventListener('click', () => window.krec.minimizePanel())

setState('idle')
