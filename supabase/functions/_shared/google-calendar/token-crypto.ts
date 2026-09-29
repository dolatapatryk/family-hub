import { hexBytes, HttpError, utf8Hex } from './http.ts'

function decodedKeys(): Record<string, string> {
  const raw = Deno.env.get('GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEYS')
  if (!raw) throw new Error('Google token encryption keys are not configured')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Google token encryption keys')
  return value as Record<string, string>
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim().replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function keyFor(version: string): Promise<CryptoKey> {
  const encoded = decodedKeys()[version]
  if (!encoded) throw new Error(`Google token encryption key version ${version} is unavailable`)
  const raw = decodeBase64(encoded)
  if (raw.byteLength !== 32) throw new Error('Google token encryption keys must contain 32 bytes')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function assertTokenEncryptionConfigured(): Promise<void> {
  const currentVersion = Deno.env.get('GOOGLE_CALENDAR_TOKEN_CURRENT_KEY_VERSION')?.trim()
  if (!currentVersion) {
    throw new HttpError(503, 'integration_not_configured', 'Szyfrowanie tokenów Google Calendar nie jest skonfigurowane.')
  }
  try {
    await keyFor(currentVersion)
  } catch {
    throw new HttpError(503, 'integration_not_configured', 'Szyfrowanie tokenów Google Calendar nie jest skonfigurowane poprawnie.')
  }
}

export async function encryptRefreshToken(
  refreshToken: string,
  connectionId: string,
): Promise<{ ciphertextHex: string; keyVersion: string }> {
  const keyVersion = Deno.env.get('GOOGLE_CALENDAR_TOKEN_CURRENT_KEY_VERSION')?.trim()
  if (!keyVersion) throw new Error('Current Google token encryption key version is not configured')
  const key = await keyFor(keyVersion)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv: nonce,
    additionalData: new TextEncoder().encode(connectionId),
  }, key, new TextEncoder().encode(refreshToken)))
  const output = new Uint8Array(nonce.length + ciphertext.length)
  output.set(nonce)
  output.set(ciphertext, nonce.length)
  return { ciphertextHex: utf8Hex(output), keyVersion }
}

export async function decryptRefreshToken(
  ciphertextHex: string,
  keyVersion: string,
  connectionId: string,
): Promise<string> {
  const ciphertext = hexBytes(ciphertextHex)
  if (ciphertext.length < 29) throw new Error('Encrypted Google credential is malformed')
  const nonce = ciphertext.slice(0, 12)
  const key = await keyFor(keyVersion)
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: nonce,
    additionalData: new TextEncoder().encode(connectionId),
  }, key, ciphertext.slice(12))
  return new TextDecoder().decode(plaintext)
}
