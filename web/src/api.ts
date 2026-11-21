/** Raised when the API answers 401, so the app can drop back to the login screen. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

let onUnauthorized: (() => void) | null = null

/** Register the callback invoked whenever any request returns 401. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }

  // The login call handles its own 401 (wrong passcode) — never bounce the whole app.
  if (response.status === 401 && path !== '/api/auth/login') {
    onUnauthorized?.()
    throw new UnauthorizedError()
  }
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload as T
}
