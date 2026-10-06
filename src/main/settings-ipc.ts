import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { SettingsUpdate, ValidationResult } from '../shared/types'
import { BunnyError, validateCredentials } from './bunny'
import { encryptSecret } from './secrets'
import { defaultRecordingsDir, getCredentials, getSettings, publicSettings, setSettings } from './store'

const LIBRARY_ID = /^\d+$/

async function check(libraryId: string, apiKey: string | null): Promise<ValidationResult> {
  if (!LIBRARY_ID.test(libraryId)) return { ok: false, message: 'The Library ID is a number, like 123456.' }
  const key = apiKey ?? getCredentials()?.apiKey
  if (!key) return { ok: false, message: 'Enter the API key.' }
  try {
    await validateCredentials({ libraryId, apiKey: key })
    return { ok: true, message: 'Connected to your Bunny library.' }
  } catch (err) {
    const message = err instanceof BunnyError ? err.message : String(err)
    return { ok: false, message }
  }
}

export function registerSettingsIpc(openSettings: () => void): void {
  ipcMain.on(IPC.settingsOpen, () => openSettings())
  ipcMain.on(IPC.settingsClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle(IPC.settingsGet, () => publicSettings())

  ipcMain.handle(IPC.settingsValidate, (_event, libraryId: string, apiKey: string | null) =>
    check(libraryId.trim(), apiKey?.trim() || null)
  )

  ipcMain.handle(IPC.settingsSave, async (_event, update: SettingsUpdate): Promise<ValidationResult> => {
    const libraryId = update.libraryId.trim()
    const apiKey = update.apiKey === null ? null : update.apiKey.trim()
    const stored = getSettings()
    const removingBunny = libraryId === '' && (apiKey === '' || apiKey === null)

    // Only talk to Bunny when its details changed; a wrong key is refused, not saved.
    const bunnyChanged = libraryId !== stored.libraryId || (apiKey !== null && apiKey !== '')
    if (!removingBunny && bunnyChanged) {
      const result = await check(libraryId, apiKey || null)
      if (!result.ok) return result
    }

    setSettings({
      libraryId,
      apiKeyEncrypted: removingBunny || apiKey === '' ? '' : apiKey ? encryptSecret(apiKey) : stored.apiKeyEncrypted,
      micDeviceId: update.micDeviceId,
      saveDir: update.saveDir === defaultRecordingsDir() ? '' : update.saveDir
    })
    return { ok: true, message: 'Saved.' }
  })

  ipcMain.handle(IPC.settingsChooseFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Where should Krec save recordings?',
      defaultPath: publicSettings().saveDir,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })
}
