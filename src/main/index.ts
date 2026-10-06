import { join } from 'path'
import { app, BrowserWindow, clipboard, ipcMain, screen, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { registerCapture } from './capture'
import { killConversions } from './convert'
import { registerRecorderIpc } from './recorder-ipc'
import { registerSettingsIpc } from './settings-ipc'
import { getSettings } from './store'
import { resumeUploads, startUpload } from './uploads'

const PANEL_WIDTH = 300
const PANEL_HEIGHT = 108
const SCREEN_MARGIN = 24
const BACKGROUND = '#1c1c1f'

let panel: BrowserWindow | null = null
let settings: BrowserWindow | null = null

const appIcon = (): string => join(app.getAppPath(), 'assets', 'icon.png')

const secureWebPreferences = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
})

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
    icon: appIcon(),
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: BACKGROUND,
    webPreferences: secureWebPreferences()
  })
  win.setAlwaysOnTop(true, 'floating')
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    panel = null
  })
  loadRenderer(win, 'panel')
  return win
}

function createPicker(): BrowserWindow {
  const win = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 520,
    minHeight: 360,
    title: 'Choose what to record',
    icon: appIcon(),
    autoHideMenuBar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: BACKGROUND,
    webPreferences: secureWebPreferences()
  })
  win.once('ready-to-show', () => win.show())
  loadRenderer(win, 'picker')
  return win
}

function openSettings(): void {
  if (settings) return settings.focus()
  settings = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 480,
    title: 'Krec Settings',
    icon: appIcon(),
    autoHideMenuBar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: BACKGROUND,
    webPreferences: secureWebPreferences()
  })
  settings.once('ready-to-show', () => settings?.show())
  settings.on('closed', () => {
    settings = null
  })
  loadRenderer(settings, 'settings')
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
    ipcMain.on(IPC.showFile, (_event, path: string) => shell.showItemInFolder(path))
    ipcMain.on(IPC.openPath, (_event, path: string) => void shell.openPath(path))
    ipcMain.on(IPC.copyText, (_event, text: string) => clipboard.writeText(text))
    ipcMain.on(IPC.uploadRetry, (_event, id: string) => void startUpload(id))
    registerCapture(createPicker)
    registerRecorderIpc()
    registerSettingsIpc(openSettings)

    panel = createPanel()
    resumeUploads()
    // First run: nothing to upload to yet, so ask for the AWS setup straight away.
    if (!getSettings().aws) openSettings()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', killConversions)
}
