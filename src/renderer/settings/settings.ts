import type { ValidationResult } from '../../shared/types'
import { micName } from '../shared/mic'

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el as T
}

const awsCode = byId<HTMLTextAreaElement>('aws-code')
const awsStatus = byId('aws-status')
const testResult = byId('test-result')
const mic = byId<HTMLSelectElement>('mic')
const micNote = byId('mic-note')
const meterFill = byId('meter-fill')
const saveDir = byId('save-dir')
const saveResult = byId('save-result')
const saveBtn = byId<HTMLButtonElement>('btn-save')
const testBtn = byId<HTMLButtonElement>('btn-test')

// Browser device ids for the Windows default and communications devices; not real devices.
const ALIAS_IDS = ['default', 'communications']

const webcam = byId<HTMLSelectElement>('webcam')
const webcamPreview = byId<HTMLVideoElement>('webcam-preview')
const webcamNote = byId('webcam-note')

let savedMicId = ''
let savedWebcamId = ''

function showResult(el: HTMLElement, result: ValidationResult | null): void {
  el.textContent = result?.message ?? ''
  el.className = `result ${result ? (result.ok ? 'ok' : 'error') : ''}`
}

// --- Microphone list and live level meter ---------------------------------

async function refreshMics(): Promise<void> {
  const selected = mic.value || savedMicId
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  const windowsDefault = devices.find((d) => d.deviceId === 'default')
  const real = devices.filter((d) => !ALIAS_IDS.includes(d.deviceId))

  const options = [new Option(`Windows default${windowsDefault ? ` (${micName(windowsDefault.label)})` : ''}`, '')]
  for (const d of real) options.push(new Option(micName(d.label) || 'Unnamed microphone', d.deviceId))
  // A saved mic that is unplugged (e.g. on the other side of a USB switch) stays selectable.
  const missing = selected !== '' && !real.some((d) => d.deviceId === selected)
  if (missing) options.push(new Option('Saved microphone (not connected right now)', selected))

  mic.replaceChildren(...options)
  mic.value = selected
  micNote.textContent = missing
    ? 'Your saved microphone is not connected. Recordings use the Windows default until it is back.'
    : 'Speak and watch the bar to check the mic.'
  void startMeter()
}

let meterStream: MediaStream | null = null
let meterContext: AudioContext | null = null
let meterFrame = 0

async function startMeter(): Promise<void> {
  cancelAnimationFrame(meterFrame)
  meterStream?.getTracks().forEach((t) => t.stop())
  await meterContext?.close()
  meterFill.style.width = '0'

  try {
    meterStream = await navigator.mediaDevices.getUserMedia({
      audio: mic.value ? { deviceId: { exact: mic.value } } : true
    })
  } catch {
    meterStream = null
    return
  }
  meterContext = new AudioContext()
  const analyser = meterContext.createAnalyser()
  meterContext.createMediaStreamSource(meterStream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)

  const draw = (): void => {
    analyser.getFloatTimeDomainData(samples)
    let peak = 0
    for (const s of samples) peak = Math.max(peak, Math.abs(s))
    // Map -60 dB..0 dB onto the bar so normal speech fills roughly half of it.
    const db = peak > 0 ? 20 * Math.log10(peak) : -100
    meterFill.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`
    meterFrame = requestAnimationFrame(draw)
  }
  draw()
}

// --- Webcam list and round preview ----------------------------------------

async function refreshWebcams(): Promise<void> {
  const selected = webcam.value || savedWebcamId
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')

  const options = [new Option(cameras.length ? `First available (${cameras[0].label || 'camera'})` : 'No camera found', '')]
  for (const c of cameras) options.push(new Option(c.label || 'Unnamed camera', c.deviceId))
  const missing = selected !== '' && !cameras.some((c) => c.deviceId === selected)
  if (missing) options.push(new Option('Saved camera (not connected right now)', selected))

  webcam.replaceChildren(...options)
  webcam.value = selected
  webcamNote.textContent = missing
    ? 'Your saved camera is not connected. The bubble uses the first available camera until it is back.'
    : 'Turn the bubble on or off with the Webcam toggle on the panel.'
  void startPreview()
}

let previewStream: MediaStream | null = null

async function startPreview(): Promise<void> {
  previewStream?.getTracks().forEach((t) => t.stop())
  previewStream = null
  webcamPreview.srcObject = null
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({
      video: webcam.value ? { deviceId: { exact: webcam.value } } : true,
      audio: false
    })
    webcamPreview.srcObject = previewStream
    await webcamPreview.play()
  } catch {
    /* camera busy or unplugged: the preview stays empty */
  }
}

// --- Load, test, save ----------------------------------------------------

async function load(): Promise<void> {
  const s = await window.krec.getSettings()
  if (s.aws) {
    awsStatus.textContent = `Connected: bucket ${s.aws.bucket} (${s.aws.region}), links on ${s.aws.cdnDomain}, access key …${s.aws.accessKeyHint}.`
    awsCode.placeholder = 'Paste a new setup code only to replace the current one.'
  } else {
    awsStatus.textContent = 'Not set up yet. Recordings stay on this PC until it is.'
    awsCode.placeholder = 'krec1:…'
  }
  saveDir.textContent = s.saveDir
  savedMicId = s.micDeviceId
  savedWebcamId = s.webcamDeviceId

  // Device names are only revealed once each kind of device has been opened once.
  for (const kind of ['audio', 'video'] as const) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ [kind]: true })
      probe.getTracks().forEach((t) => t.stop())
    } catch {
      /* no device of this kind: its list just stays short */
    }
  }
  await refreshMics()
  await refreshWebcams()
}

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true
  showResult(testResult, { ok: true, message: 'Testing…' })
  testResult.className = 'result'
  const result = await window.krec.validateAws(awsCode.value.trim() || null)
  showResult(testResult, result)
  testBtn.disabled = false
})

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true
  saveResult.textContent = 'Saving…'
  saveResult.className = 'result'
  const result = await window.krec.saveSettings({
    awsSetupCode: awsCode.value.trim() || null,
    micDeviceId: mic.value,
    webcamDeviceId: webcam.value,
    saveDir: saveDir.textContent ?? ''
  })
  saveBtn.disabled = false
  if (result.ok) window.krec.closeSettings()
  else showResult(saveResult, result)
})

byId('btn-cancel').addEventListener('click', () => window.krec.closeSettings())
byId('btn-folder').addEventListener('click', async () => {
  const dir = await window.krec.chooseFolder()
  if (dir) saveDir.textContent = dir
})
byId('btn-open-folder').addEventListener('click', () => window.krec.openPath(saveDir.textContent ?? ''))
mic.addEventListener('change', () => void startMeter())
webcam.addEventListener('change', () => void startPreview())
navigator.mediaDevices.addEventListener('devicechange', () => {
  void refreshMics()
  void refreshWebcams()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.krec.closeSettings()
})

void load()
