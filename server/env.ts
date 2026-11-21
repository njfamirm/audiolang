/**
 * Cloudflare Worker bindings.
 * Secrets are provided by `.dev.vars` locally and `wrangler secret put` in production.
 */
export type Env = {
  STORE_KV: KVNamespace
  ASSETS: Fetcher
  /** Workers AI binding — used for Whisper speech-to-text. */
  AI: Ai
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
}