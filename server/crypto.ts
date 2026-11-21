/**
 * Web Crypto only — no `node:crypto`, so this runs on Cloudflare Workers.
 */
export function randomUUID(): string {
  return crypto.randomUUID()
}