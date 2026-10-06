import { startRecording, type Recording } from '../recording/recorder'

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
const showFileBtn = byId<HTMLButtonElement>('btn-show-file')

let state: PanelState = 'idle'
let recording: Recording | null = null
let savedPath: string | null = null

function setState(next: PanelState, status = ''): void {
  state = next
  panel.dataset.state = next
  mainLabel.textContent = next === 'recording' ? 'Stop' : 'Record'
  mainBtn.disabled = next === 'picking' || next === 'saving'
  statusText.textContent = status
  showFileBtn.hidden = !(next === 'idle' && savedPath)
}

async function record(): Promise<void> {
  savedPath = null
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

function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function micStatus(mic: MediaStreamTrack | null): string {
  if (!mic) return 'Recording without microphone'
  const name = mic.label.replace(/^Default - /, '')
  return mic.muted ? `No sound from mic: ${name}` : `Recording · ${name}`
}

async function stop(): Promise<void> {
  if (state !== 'recording' || !recording) return
  const current = recording
  recording = null
  setState('saving', 'Saving…')
  try {
    const result = await current.stop()
    savedPath = result.path
    setState('idle', `Saved ${formatDuration(result.durationSec)} video.`)
  } catch (err) {
    setState('idle', `Save failed: ${(err as Error).message}`)
  }
}

mainBtn.addEventListener('click', () => {
  if (state === 'idle') void record()
  else if (state === 'recording') void stop()
})
showFileBtn.addEventListener('click', () => savedPath && window.krec.showFile(savedPath))
byId('btn-close').addEventListener('click', () => window.krec.closePanel())
byId('btn-minimize').addEventListener('click', () => window.krec.minimizePanel())

setState('idle')
