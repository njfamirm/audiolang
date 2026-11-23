# AudioLang

Audio-first English learning. Listen while you drive, study when you park.

Runs as a **single Cloudflare Worker** (Hono API + static React build + KV). No Docker,
no Postgres, no auth, no TTS.

## Architecture

| Layer | What |
| --- | --- |
| API | Hono on Cloudflare Workers (`server/index.ts`, `export default app`) |
| DB | Cloudflare KV, one key: `audiolang_store` (JSON string) |
| Audio source | Free podcast RSS (BBC 6 Minute English, BBC The English We Speak, VOA) |
| Transcript | **Groq** `whisper-large-v3-turbo` → text + precise word/sentence timings |
| Persian notes | Workers AI chat → Groq fallback, cached per segment in KV |
| Frontend | Vite + React + Tailwind, `web/src` |

There is **no HTML scraping**: the real MP3 is sent to Groq Whisper for precise timestamps,
with Workers AI Whisper and an OpenRouter audio model as automatic fallbacks. Persian notes
use Workers AI chat with a Groq fallback (reliable from Workers egress).

## Setup

```bash
cd /Volumes/Projects/me/enlearning
npm install
cp .dev.vars.example .dev.vars     # then fill the key
```

`.dev.vars` (gitignored):

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=deepseek/deepseek-chat
# OPENROUTER_TRANSCRIBE_MODEL=google/gemini-2.5-flash   (default)
# Groq — primary STT with precise word/segment timestamps (free key at console.groq.com)
GROQ_API_KEY=gsk_...
```

Audio-only mode works with **no key at all**: playback, bookmarks, speed, vocabulary.
Without a key the transcript banner explains how to enable it.

> **Audio requests need a key allowance of at least $0.50.** If OpenRouter answers
> `402 requires at least $0.50 in balance`, raise the key's usage limit at
> <https://openrouter.ai/settings/keys>.

## Run

```bash
npm run dev
```

| Service | URL |
| --- | --- |
| Web app | http://localhost:5173 |
| On your Wi-Fi | http://<your-lan-ip>:5173 (printed by Vite as `Network`) |
| Worker (API) | http://localhost:3001 |

`wrangler dev` emulates KV locally in `.wrangler/state`. Vite proxies `/api` to the
Worker, so phones only need port **5173**.

```bash
npm run typecheck   # web + worker tsconfigs
npm run build       # typecheck + vite build into web/dist
```

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler kv namespace create STORE_KV      # copy the printed id
# put that id into wrangler.toml ([[kv_namespaces]] id = "...")
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GROQ_API_KEY        # primary STT (precise word/segment timestamps)
npm run deploy
```

## Transcripts & timings

`POST /api/lessons/:id/transcribe` sends the MP3 to the audio model and stores the full
timestamped transcript (`transcribed: true`). It is cached forever: the second call
costs **zero**.

The model returns text plus timings. Timings are validated (monotonic, inside the audio,
covering most of it). If they look wrong, timings are recomputed by distributing
sentences across the audio length, and the lesson is flagged `timingApprox: true` so the
UI can show `≈ estimated timestamps`.

`POST /api/lessons/:id/align` is the free path: it distributes the **existing** transcript
across the audio length with no API call. Use it for custom lessons where you already
pasted the real transcript.

Transcribing replaces the short RSS summary with the real conversation, so cached Persian
notes for the old sentences are dropped (their sentence ids change).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | `aiConfigured`, `transcriptionConfigured`, models, feeds |
| GET | `/api/lessons` | All lessons |
| POST | `/api/lessons/sync` | Fetch + dedupe podcast episodes (native fetch + regex) |
| POST | `/api/lessons/custom` | `{ title, audioUrl, transcript }` |
| POST | `/api/lessons/:id/transcribe` | Full transcript + timings via OpenRouter (cached) |
| POST | `/api/lessons/:id/align` | Free: estimate timings for the current transcript |
| PATCH | `/api/lessons/:id/progress` | `{ lastPositionSec?, addBookmarkSec? }` |
| POST | `/api/lessons/:lessonId/segments/:segmentId/explain` | Cached Persian explanation |
| GET/POST | `/api/vocab` | List / add vocabulary |
| DELETE | `/api/vocab/:id` | Remove a vocabulary item |

## Study / Driving

- **Study Mode** — active sentence highlighted from timings
  (`border-l-2 border-ink bg-neutral-900`), a `▶` jump button per timestamped sentence,
  clicking the text still opens the Persian card.
- **Driving Mode** — oversized targets, Media Session handlers for steering-wheel
  controls, and `↺ Repeat` (replaces `−5s` once the lesson is transcribed) that jumps to
  the start of the active sentence.
- One persistent `<audio>` element at the app root: switching modes never interrupts
  playback. Position is saved every 5 seconds.

## Data

`data/store.json` is only the **seed fixture** bundled at build time. It is loaded into
KV on the first request when `audiolang_store` is missing. Everything after that lives
in KV.