import type { CaptureSource } from '../../shared/types'

const container = document.getElementById('sources') as HTMLElement
const cards = new Map<string, HTMLButtonElement>()

function sourceCard(source: CaptureSource): HTMLButtonElement {
  const card = document.createElement('button')
  card.className = 'card'
  card.title = source.name

  const thumb = document.createElement('img')
  thumb.className = 'thumb'
  thumb.alt = ''
  if (source.thumbnail) thumb.src = source.thumbnail

  const label = document.createElement('div')
  label.className = 'label'
  if (source.icon) {
    const icon = document.createElement('img')
    icon.className = 'icon'
    icon.src = source.icon
    icon.alt = ''
    label.append(icon)
  }
  const name = document.createElement('span')
  name.textContent = source.name
  label.append(name)

  card.append(thumb, label)
  card.addEventListener('click', () => window.krec.chooseSource(source.id))
  cards.set(source.id, card)
  return card
}

function section(title: string, sources: CaptureSource[]): HTMLElement {
  const wrap = document.createElement('section')
  const heading = document.createElement('h2')
  heading.textContent = title
  const grid = document.createElement('div')
  grid.className = 'grid'
  grid.append(...sources.map(sourceCard))
  wrap.append(heading, grid)
  return wrap
}

async function render(): Promise<void> {
  const sources = await window.krec.listSources(false)
  const screens = sources.filter((s) => s.kind === 'screen')
  const windows = sources.filter((s) => s.kind === 'window')
  container.replaceChildren(section(screens.length === 1 ? 'Screen' : 'Screens', screens))
  if (windows.length) container.append(section('Windows', windows))

  // Fill in thumbnails, and drop windows that turned out not to be capturable.
  const withThumbs = new Map((await window.krec.listSources(true)).map((s) => [s.id, s]))
  for (const [id, card] of cards) {
    const source = withThumbs.get(id)
    if (source) (card.querySelector('.thumb') as HTMLImageElement).src = source.thumbnail
    else card.remove()
  }
}

const cancel = (): void => window.krec.chooseSource(null)
document.getElementById('btn-cancel')?.addEventListener('click', cancel)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancel()
})

render().catch((err) => {
  container.textContent = `Could not list screens and windows: ${err}`
})
