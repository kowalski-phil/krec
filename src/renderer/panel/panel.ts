import type { HistoryItem, UploadUpdate } from '../../shared/types'
import { prepareRecording, type Recording } from '../recording/recorder'
import { micName } from '../shared/mic'

type PanelState = 'idle' | 'picking' | 'countdown' | 'recording' | 'saving'

const COUNTDOWN_SECONDS = 3

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el as T
}

const panel = document.querySelector('.panel') as HTMLElement
const mainBtn = byId<HTMLButtonElement>('btn-main')
const mainLabel = byId('main-label')
const pauseBtn = byId<HTMLButtonElement>('btn-pause')
const pauseLabel = byId('pause-label')
const timer = byId('timer')
const statusText = byId('status-text')
const actionBtn = byId<HTMLButtonElement>('btn-status-action')
const webcamToggle = byId<HTMLInputElement>('toggle-webcam')

const MAIN_LABELS: Record<PanelState, string> = {
  idle: 'Record',
  picking: 'Record',
  countdown: 'Cancel',
  recording: 'Stop',
  saving: 'Record'
}

let state: PanelState = 'idle'
let recording: Recording | null = null
let lastItemId: string | null = null // the most recent recording, whose upload the status line follows
let statusAction: (() => void) | null = null
let cancelCountdown: (() => void) | null = null
let timerInterval: number | undefined

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
  panel.dataset.paused = 'false'
  mainLabel.textContent = MAIN_LABELS[next]
  mainBtn.disabled = next === 'picking' || next === 'saving'
  setStatus(status)
}

// --- Upload status (idle) --------------------------------------------------

function showUpload(item: HistoryItem, percent: number | null): void {
  const showFile = { label: 'Show file', run: () => window.krec.showFile(item.localPath) }
  switch (item.status) {
    case 'uploading':
      return setStatus(percent === null ? 'Uploading…' : `Uploading… ${percent}%`)
    case 'ready':
      return setStatus('Link copied ✓', { label: 'Copy again', run: () => item.shareUrl && window.krec.copyText(item.shareUrl) })
    case 'failed':
      return setStatus('Upload failed.', { label: 'Retry', run: () => window.krec.retryUpload(item.id) }, item.error ?? '')
    case 'local':
      return setStatus('Saved locally (AWS not set up).', showFile)
  }
}

window.krec.onUploadUpdate(({ item, percent }: UploadUpdate) => {
  if (item.id === lastItemId && state === 'idle') showUpload(item, percent)
})

// --- Recording flow: pick -> prepare -> countdown -> record -> stop --------

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** Shows 3, 2, 1. Resolves false if the user clicked Cancel (or the source vanished). */
function countdown(): Promise<boolean> {
  return new Promise((resolve) => {
    let left = COUNTDOWN_SECONDS
    timer.textContent = String(left)
    const tick = window.setInterval(() => {
      left -= 1
      if (left > 0) return void (timer.textContent = String(left))
      window.clearInterval(tick)
      cancelCountdown = null
      resolve(true)
    }, 1000)
    cancelCountdown = () => {
      window.clearInterval(tick)
      cancelCountdown = null
      resolve(false)
    }
  })
}

function micStatus(mic: MediaStreamTrack | null): string {
  if (!mic) return 'Recording without microphone'
  const name = micName(mic.label)
  // A muted track means the device delivers no sound at all (e.g. a disconnected virtual mic).
  return mic.muted ? `No sound from mic: ${name}` : name
}

function showRecordingStatus(): void {
  if (state !== 'recording' || !recording) return
  const noCamera = webcamToggle.checked && !recording.hasWebcam ? 'No webcam found · ' : ''
  setStatus(recording.paused ? 'Paused' : noCamera + micStatus(recording.mic))
}

async function record(): Promise<void> {
  setState('picking', 'Choose what to record…')
  const chosen = await window.krec.pickSource()
  if (!chosen) return setState('idle')

  setState('countdown', 'Click Cancel to stop the countdown.')
  timer.textContent = ''
  let rec: Recording
  try {
    rec = await prepareRecording(() => {
      // The captured window was closed: abort a countdown, or save what was recorded.
      if (state === 'countdown') cancelCountdown?.()
      else void stop()
    })
  } catch (err) {
    return setState('idle', `Could not start: ${(err as Error).message}`)
  }

  if (!(await countdown())) {
    await rec.cancel()
    return setState('idle', 'Recording cancelled.')
  }

  recording = rec
  rec.start()
  setState('recording')
  showRecordingStatus()
  rec.mic?.addEventListener('mute', showRecordingStatus)
  rec.mic?.addEventListener('unmute', showRecordingStatus)
  timer.textContent = formatTime(0)
  timerInterval = window.setInterval(() => (timer.textContent = formatTime(rec.elapsedMs())), 250)
}

function togglePause(): void {
  if (state !== 'recording' || !recording) return
  if (recording.paused) recording.resume()
  else recording.pause()
  panel.dataset.paused = String(recording.paused)
  pauseLabel.textContent = recording.paused ? 'Resume' : 'Pause'
  showRecordingStatus()
}

async function stop(): Promise<void> {
  if (state !== 'recording' || !recording) return
  const current = recording
  recording = null
  window.clearInterval(timerInterval)
  pauseLabel.textContent = 'Pause'
  setState('saving', 'Saving…')
  try {
    const result = await current.stop()
    lastItemId = result.historyId
    setState('idle', result.willUpload ? 'Uploading…' : '')
    if (!result.willUpload) {
      setStatus('Saved locally (AWS not set up).', {
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
  else if (state === 'countdown') cancelCountdown?.()
  else if (state === 'recording') void stop()
})
pauseBtn.addEventListener('click', togglePause)
webcamToggle.addEventListener('change', () => window.krec.setWebcamEnabled(webcamToggle.checked))
void window.krec.getSettings().then((s) => (webcamToggle.checked = s.webcamEnabled))
actionBtn.addEventListener('click', () => statusAction?.())
byId('btn-settings').addEventListener('click', () => window.krec.openSettings())
byId('btn-close').addEventListener('click', () => window.krec.closePanel())
byId('btn-minimize').addEventListener('click', () => window.krec.minimizePanel())

setState('idle')
