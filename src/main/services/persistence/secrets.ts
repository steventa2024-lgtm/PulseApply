import type { AppDb } from './database'
import { registerSecret } from '../logger'

/**
 * Encryption backend. In Electron this wraps `safeStorage` (DPAPI on Windows,
 * Keychain on macOS, libsecret/kwallet on Linux). Tests use an in-memory fake.
 */
export interface SecretCipher {
  readonly level: 'os' | 'basic' | 'unavailable'
  encrypt(plain: string): string
  decrypt(stored: string): string
}

export class PlaintextCipher implements SecretCipher {
  readonly level = 'unavailable' as const
  encrypt(plain: string): string {
    return plain
  }
  decrypt(stored: string): string {
    return stored
  }
}

/**
 * Credential store. Values never leave the main process: the renderer only
 * ever learns whether a key is configured.
 */
export class SecretStore {
  constructor(
    private readonly db: AppDb,
    private readonly cipher: SecretCipher
  ) {
    for (const row of this.db.all<{ key: string }>('SELECT key FROM secrets')) {
      registerSecret(this.get(row.key))
    }
  }

  get level(): SecretCipher['level'] {
    return this.cipher.level
  }

  get(key: string): string | undefined {
    const row = this.db.get<{ value: string; encrypted: number }>(
      'SELECT value, encrypted FROM secrets WHERE key = ?',
      [key]
    )
    if (!row) return undefined
    try {
      return row.encrypted ? this.cipher.decrypt(row.value) : row.value
    } catch {
      return undefined
    }
  }

  has(key: string): boolean {
    return !!this.get(key)
  }

  set(key: string, value: string): void {
    const trimmed = value.trim()
    if (!trimmed) {
      this.delete(key)
      return
    }
    registerSecret(trimmed)
    const encrypted = this.cipher.level !== 'unavailable'
    this.db.run(
      `INSERT INTO secrets (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = excluded.updated_at`,
      [
        key,
        encrypted ? this.cipher.encrypt(trimmed) : trimmed,
        encrypted ? 1 : 0,
        new Date().toISOString()
      ]
    )
  }

  delete(key: string): void {
    this.db.run('DELETE FROM secrets WHERE key = ?', [key])
  }

  encryptBlob(plain: string): { value: string; encrypted: boolean } {
    if (this.cipher.level === 'unavailable') return { value: plain, encrypted: false }
    return { value: this.cipher.encrypt(plain), encrypted: true }
  }

  decryptBlob(value: string, encrypted: boolean): string {
    return encrypted ? this.cipher.decrypt(value) : value
  }
}
