function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el as T
}

byId('btn-close').addEventListener('click', () => window.krec.closePanel())
byId('btn-minimize').addEventListener('click', () => window.krec.minimizePanel())
