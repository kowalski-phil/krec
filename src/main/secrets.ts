import { safeStorage } from 'electron'

// Windows DPAPI via Electron safeStorage: the stored string can only be decrypted by
// this Windows user on this machine, so the config file never holds the key in plain text.

export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available')
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(encrypted: string): string {
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}
