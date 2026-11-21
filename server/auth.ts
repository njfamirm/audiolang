import type { Env } from './env'

/**
 * Stateless session auth using Web Crypto only (no `node:crypto`), so it runs on Workers.
 *
 * A token is `base64url(payload).base64url(hmacSHA256(secret, payload))` where the payload is a
 * tiny JSON object `{ exp }` (unix seconds). Nothing is stored server-side; the cookie is the state.
 */

export const SESSION_COOKIE = 'audiolang_session'
/** 30 days, in seconds. */
export const SESSION_TTL_SECONDS = 2592000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function secret(env: Env): string {
  return env.AUTH_SECRET?.trim() || env.APP_PASSCODE?.trim() || 'audiolang-insecure-dev'
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Auth is only enforced when a passcode is configured. */
export function isAuthRequired(env: Env): boolean {
  return Boolean(env.APP_PASSCODE?.trim())
}

/** True when `input` matches any code in the comma-separated APP_PASSCODE list. */
export function validatePasscode(env: Env, input: string): boolean {
  const configured = env.APP_PASSCODE?.trim()
  if (!configured) return true
  const codes = configured
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
  return codes.includes(input.trim())
}

export async function signToken(env: Env): Promise<string> {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS })),
  )
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload))
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`
}

export async function verifyToken(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env),
      base64UrlDecode(signature),
      encoder.encode(payload),
    )
    if (!valid) return false
    const data = JSON.parse(decoder.decode(base64UrlDecode(payload))) as { exp?: number }
    return typeof data.exp === 'number' && data.exp * 1000 > Date.now()
  } catch {
    return false
  }
}
