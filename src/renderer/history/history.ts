import type { HistoryItem, PublicSettings, UploadUpdate } from '../../shared/types'

const list = document.getElementById('list') as HTMLElement
const count = document.getElementById('count') as HTMLElement
const message = document.getElementById('message') as HTMLElement

let items: HistoryItem[] = []
let settings: PublicSettings | null = null
const uploadPercent = new Map<string, number>()

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(sec: number): string {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

function statusChip(item: HistoryItem): HTMLElement {
  const chip = document.createElement('span')
  chip.className = `chip chip-${item.status}`
  const percent = uploadPercent.get(item.id)
  chip.textContent = {
    uploading: percent === undefined ? 'Uploading…' : `Uploading ${percent}%`,
    ready: 'Online',
    failed: 'Upload failed',
    local: 'On this PC only'
  }[item.status]
  if (item.error) chip.title = item.error
  return chip
}

function showMessage(text: string, isError = false): void {
  message.textContent = text
  message.className = `message ${isError ? 'error' : ''}`
  message.hidden = text === ''
}

function button(label: string, onClick: (btn: HTMLButtonElement) => void, className = 'btn'): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.className = className
  btn.textContent = label
  btn.addEventListener('click', () => onClick(btn))
  return btn
}

function row(item: HistoryItem): HTMLElement {
  const el = document.createElement('article')
  el.className = 'row'
  el.dataset.id = item.id

  const thumb = document.createElement('img')
  thumb.className = 'thumb'
  thumb.alt = ''
  thumb.loading = 'lazy'
  thumb.src = `krec-thumb://${item.id}`

  const info = document.createElement('div')
  info.className = 'info'
  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = formatDate(item.createdAt)
  title.title = item.title
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.append(document.createTextNode(formatDuration(item.durationSec)), statusChip(item))

  const actions = document.createElement('div')
  actions.className = 'actions'
  const url = item.shareUrl
  if (item.status === 'ready' && url) {
    actions.append(
      button(
        'Copy link',
        (btn) => {
          window.krec.copyText(url)
          btn.textContent = 'Copied ✓'
          setTimeout(() => (btn.textContent = 'Copy link'), 1500)
        },
        'btn btn-primary'
      ),
      button('Open in browser', () => window.krec.openExternal(url))
    )
  }
  if ((item.status === 'failed' || item.status === 'local') && settings?.aws) {
    actions.append(button(item.status === 'failed' ? 'Retry' : 'Upload', () => window.krec.retryUpload(item.id), 'btn btn-primary'))
  }
  actions.append(button('Show file', () => window.krec.showFile(item.localPath)))
  const del = button(
    'Delete',
    async (btn) => {
      btn.disabled = true
      const result = await window.krec.deleteRecording(item.id)
      btn.disabled = false
      showMessage(result.ok ? '' : result.message, !result.ok)
    },
    'btn btn-danger'
  )
  del.disabled = item.status === 'uploading'
  actions.append(del)

  info.append(title, meta, actions)
  el.append(thumb, info)
  return el
}

function render(): void {
  count.textContent = items.length ? `(${items.length})` : ''
  if (!items.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'No recordings yet. Click Record on the Krec panel to make one.'
    list.replaceChildren(empty)
    return
  }
  list.replaceChildren(...items.map(row))
}

async function reload(): Promise<void> {
  ;[items, settings] = await Promise.all([window.krec.listHistory(), window.krec.getSettings()])
  render()
}

// Upload progress and status changes: swap just that row so the list does not jump.
window.krec.onUploadUpdate(({ item, percent }: UploadUpdate) => {
  const index = items.findIndex((h) => h.id === item.id)
  if (index === -1) return void reload()
  items[index] = item
  if (percent === null) uploadPercent.delete(item.id)
  else uploadPercent.set(item.id, percent)
  list.querySelector(`[data-id="${item.id}"]`)?.replaceWith(row(item))
})
window.krec.onHistoryChanged(() => void reload())

document.getElementById('btn-open-folder')?.addEventListener('click', () => {
  if (settings) window.krec.openPath(settings.saveDir)
})
// Settings may change while this window is open (e.g. AWS set up), which affects the buttons.
window.addEventListener('focus', () => void reload())

void reload()
