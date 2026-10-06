import { join } from 'path'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'

const PANEL_WIDTH = 300
const PANEL_HEIGHT = 88
const SCREEN_MARGIN = 24

let panel: BrowserWindow | null = null

function loadRenderer(win: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    win.loadURL(`${devUrl}/${page}/index.html`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
  }
}

function createPanel(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    x: workArea.x + workArea.width - PANEL_WIDTH - SCREEN_MARGIN,
    y: workArea.y + SCREEN_MARGIN,
    title: 'Krec',
    icon: join(app.getAppPath(), 'assets', 'icon.png'),
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#1c1c1f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    panel = null
  })
  loadRenderer(win, 'panel')
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!panel) return
    if (panel.isMinimized()) panel.restore()
    panel.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.kowalski.krec')

    ipcMain.on(IPC.panelClose, () => app.quit())
    ipcMain.on(IPC.panelMinimize, () => panel?.minimize())

    panel = createPanel()
  })

  app.on('window-all-closed', () => app.quit())
}
