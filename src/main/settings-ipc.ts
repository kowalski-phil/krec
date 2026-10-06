import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import type { SettingsUpdate, ValidationResult } from '../shared/types'
import { parseSetupCode, testConnection, type AwsConfig } from './aws'
import { encryptSecret } from './secrets'
import { defaultRecordingsDir, getAwsConfig, publicSettings, setSettings } from './store'

async function check(cfg: AwsConfig): Promise<ValidationResult> {
  try {
    await testConnection(cfg)
    return { ok: true, message: `Connected. Links will look like https://${cfg.cdnDomain}/v/…` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

/** A null code tests the stored setup. */
async function validate(code: string | null): Promise<ValidationResult> {
  let cfg: AwsConfig | null
  try {
    cfg = code ? parseSetupCode(code) : getAwsConfig()
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
  if (!cfg) return { ok: false, message: 'Paste the setup code first.' }
  return check(cfg)
}

export function registerSettingsIpc(openSettings: () => void): void {
  ipcMain.on(IPC.settingsOpen, () => openSettings())
  ipcMain.on(IPC.settingsClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close())
  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  ipcMain.on(IPC.settingsSetWebcamEnabled, (_event, enabled: boolean) => setSettings({ webcamEnabled: enabled }))
  ipcMain.handle(IPC.settingsValidate, (_event, code: string | null) => validate(code?.trim() || null))

  ipcMain.handle(IPC.settingsSave, async (_event, update: SettingsUpdate): Promise<ValidationResult> => {
    const code = update.awsSetupCode?.trim() || null
    if (code) {
      // A new setup code is tested end to end first; a broken one is refused, not saved.
      const result = await validate(code)
      if (!result.ok) return result
      const { secretAccessKey, ...rest } = parseSetupCode(code)
      setSettings({ aws: { ...rest, secretEncrypted: encryptSecret(secretAccessKey) } })
    }
    setSettings({
      micDeviceId: update.micDeviceId,
      webcamDeviceId: update.webcamDeviceId,
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
