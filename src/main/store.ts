import { join } from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import type { HistoryItem, PublicSettings } from '../shared/types'
import type { AwsConfig } from './aws'
import { decryptSecret } from './secrets'

// The AWS setup minus the secret key, which is kept DPAPI-encrypted next to it.
type StoredAws = Omit<AwsConfig, 'secretAccessKey'> & { secretEncrypted: string }

interface StoredSettings {
  aws: StoredAws | null
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
      settings: { aws: null, micDeviceId: '', saveDir: '' },
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
    aws: s.aws
      ? {
          region: s.aws.region,
          bucket: s.aws.bucket,
          cdnDomain: s.aws.cdnDomain,
          accessKeyHint: s.aws.accessKeyId.slice(-4)
        }
      : null,
    micDeviceId: s.micDeviceId,
    saveDir: s.saveDir || defaultRecordingsDir()
  }
}

/** Null when AWS is not set up yet. */
export function getAwsConfig(): AwsConfig | null {
  const aws = getSettings().aws
  if (!aws) return null
  const { secretEncrypted, ...rest } = aws
  return { ...rest, secretAccessKey: decryptSecret(secretEncrypted) }
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
