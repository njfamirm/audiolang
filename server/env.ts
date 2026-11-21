/**
 * Cloudflare Worker bindings.
 * Secrets are provided by `.dev.vars` locally and `wrangler secret put` in production.
 */
export type Env = {
  STORE_KV: KVNamespace
  ASSETS: Fetcher
  /** Workers AI binding — used for Whisper speech-to-text and chat explanations. */
  AI: Ai
  /**
   * Shared passcode(s) that gate every write/read API route.
   * Accepts a single code or a comma-separated list so access can be shared with a few friends,
   * e.g. "secret123" or "pass1,pass2,pass3". Unset = auth disabled (local dev only).
   */
  APP_PASSCODE?: string
  /** Optional secret used to sign session tokens. Falls back to APP_PASSCODE when unset. */
  AUTH_SECRET?: string
}
