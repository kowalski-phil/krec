import { join } from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import type { HistoryItem, PublicSettings } from '../shared/types'
import { decryptSecret } from './secrets'

interface StoredSettings {
  libraryId: string
  apiKeyEncrypted: string // base64 DPAPI blob, see secrets.ts
  micDeviceId: string
  saveDir: string // '' = default
}

interface Schema {
  settings: StoredSettings
  history: HistoryItem[] // newest first
}

// Lives in %APPDATA%\Krec\config.json.
let store: Store<Schema> | null = null
function db(): Store<Schema> {
  store ??= new Store<Schema>({
    defaults: {
      settings: { libraryId: '', apiKeyEncrypted: '', micDeviceId: '', saveDir: '' },
      history: []
    }
  })
  return store
}

export function defaultRecordingsDir(): string {
  return join(app.getPath('videos'), 'Krec')
}

export function getSettings(): StoredSettings {
  return db().get('settings')
}

export function setSettings(patch: Partial<StoredSettings>): void {
  db().set('settings', { ...getSettings(), ...patch })
}

export function publicSettings(): PublicSettings {
  const s = getSettings()
  return {
    libraryId: s.libraryId,
    hasApiKey: s.apiKeyEncrypted !== '',
    micDeviceId: s.micDeviceId,
    saveDir: s.saveDir || defaultRecordingsDir()
  }
}

export interface BunnyCredentials {
  libraryId: string
  apiKey: string
}

/** Null when the Bunny library is not set up yet. */
export function getCredentials(): BunnyCredentials | null {
  const s = getSettings()
  if (!s.libraryId || !s.apiKeyEncrypted) return null
  return { libraryId: s.libraryId, apiKey: decryptSecret(s.apiKeyEncrypted) }
}

export function listHistory(): HistoryItem[] {
  return db().get('history')
}

export function getHistoryItem(id: string): HistoryItem | undefined {
  return listHistory().find((h) => h.id === id)
}

export function addHistoryItem(item: HistoryItem): void {
  db().set('history', [item, ...listHistory()])
}

export function updateHistoryItem(id: string, patch: Partial<HistoryItem>): HistoryItem {
  let updated: HistoryItem | undefined
  const history = listHistory().map((h) => (h.id === id ? (updated = { ...h, ...patch }) : h))
  if (!updated) throw new Error(`History item ${id} not found`)
  db().set('history', history)
  return updated
}
