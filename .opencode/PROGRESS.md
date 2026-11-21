# AudioLang — Progress

**Goal:** Local-first audio English learning on Cloudflare Worker + KV, OpenRouter only (no Groq/TTS).

## Done
- Migrated Node/Hono + JSON file → Worker + KV (`audiolang_store`), assets binding, `export default app`.
- Removed @hono/node-server, dotenv, rss-parser, tsx; RSS via native fetch + regex (3 feeds, verified 15 episodes).
- Transcription now Cloudflare Workers AI (`@cf/openai/whisper-large-v3-turbo`, `[ai]` binding `AI`) — no external STT key. Chunked base64 (8KB), segment parse + text-split fallback.
- `POST /transcribe` (cached, `transcribed`, `timingApprox`) + `POST /align` (free proportional timings).
- UI: transcript banner, active-sentence highlight, `▶` jump per sentence, Driving `↺ Repeat`.
- Real transcription test: EWS "Leave to one's own devices" → 25 segs, 0–161s, cached; 2nd call free.
- typecheck + build green; LAN http://192.168.70.151:5173; dev running.

## Files touched
server/index.ts, server/store.ts, server/rss.ts, server/ai.ts, server/transcribe.ts, server/json.ts, server/env.ts, server/crypto.ts, server/tsconfig.json, wrangler.toml, package.json, tsconfig.json, .dev.vars(.example), .env.example, .gitignore, README.md, web/src/{App.tsx,types.ts,index.css}, web/src/components/{StudyMode,DrivingMode,LessonList,AddLessonModal}.tsx, web/vite.config.ts, audiolang.diff

## Next step
Live at https://audiolang.njfamirm.ir (+ workers.dev). Transcription (Whisper) + explanations both working.
Added git baseline + `/diff` command (`.opencode/commands/diff.md` → `scripts/diff.sh`) → clean diff minus lockfiles/dist/generated, also saved to `ai-diff.patch`.
Open item: proxy is unauthenticated (open proxy) — restrict hosts if exposed.

## Constraints/Gotchas
- Only 1 lesson is transcribed; other 15 still hold RSS summary text → never matches audio.
- `timingApprox: true` on that lesson → highlight drifts late (proportional distribution).
- OpenRouter audio needs key allowance ≥ $0.50; key limit now 0.5, remaining $0.48 → next audio call may 402. Raise limit (~$5).
- Transcribe replaces segments → cached Persian explanations for old sentences are lost.
- Secrets in `.dev.vars` (gitignored); never print key. No OpenRouter calls without user OK.