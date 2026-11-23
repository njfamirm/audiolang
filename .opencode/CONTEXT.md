# AudioLang — Entrypoint Map

## Stack & Entrypoints
- Runtime: Cloudflare Workers + Hono API + React 18/Vite/Tailwind SPA. KV persistence, Workers AI (Whisper + chat), OpenRouter fallback.
- Bindings: `STORE_KV` (KVNamespace), `AI` (Ai), `ASSETS` (Fetcher SPA), optional `AUDIO_BUCKET` (R2, unbound), `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `deepseek/deepseek-chat`), `OPENROUTER_BASE_URL`, `OPENROUTER_TRANSCRIBE_MODEL` (default `google/gemini-2.5-flash`), `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`), `APP_PASSCODE`, `AUTH_SECRET`.
- Text AI: Workers AI first → Groq `openai/gpt-oss-120b` (JSON mode) → OpenRouter (last resort; OpenRouter WAF often 403s Cloudflare egress, so it is unreliable from Workers). Any provider error moves to the next. Transcription (`transcribe.ts`) order: Groq `whisper-large-v3-turbo` (verbose_json, precise word+segment timestamps) → Workers AI Whisper → OpenRouter audio model (`OPENROUTER_TRANSCRIBE_MODEL`, default `google/gemini-2.5-flash`, estimated timings). Only when no Groq/OpenRouter key does the daily limit surface as "Cloudflare AI daily limit reached. Please try again tomorrow."
- Dev: `npm run dev` (wrangler :3001 + vite). Build: `npm run build` (typecheck + vite). Deploy: `npm run deploy`.
- Entries: `server/index.ts` (Worker/Hono app), `server/store.ts` (KV layer), `server/env.ts` (bindings), `server/ai.ts`, `server/auth.ts`, `server/rss.ts`, `server/transcribe.ts`, `web/src/App.tsx`, `web/src/main.tsx`.

## Data Schema
- `Store`: lessons:Lesson[] · vocab:VocabItem[] · activityLog?:Record<string,ActivityLogEntry>
- `Lesson`: id,title,source,audioUrl,publishedAt,lastPositionSec,bookmarks:number[],segments:Segment[],transcribed?,audioCached?,timingApprox?,transcriptVersion?,cefrLevel?,sourceLevel?,durationSec?,topic?,aiPack?:AiPack|null,quizCompleted?,outputCompleted?,lastOutputFeedback?:OutputFeedback|null
- `Segment`: id,index,text,startSec?,endSec?,words?:WordTiming[],explanationFa?:ExplanationFa|null
- `VocabItem`: id,word,contextSentence,meaningFa,createdAt,stage?:'new'|'learning'|'mastered',nextReviewAt?,intervalDays?,correctStreak?
- `ExplanationFa`: meaning,grammar,idioms:string[],simpleEnglish? · `AiPack`: warmup:WarmupItem[],quiz:QuizItem[],outputPrompt · `WarmupItem`: phrase,meaningFa,note? · `QuizItem`: question,options:string[],correctIndex,explanationFa · `OutputFeedback`: userText,nativeVersion,feedbackFa · `WordTiming`: text,start,end · `ActivityLogEntry`: listenSec,reviews
- KV: single key `audiolang_store` (whole JSON DB); frozen audio `audio:${id}` (arrayBuffer).

## API Routes
- POST /api/auth/login → {passcode} → {ok} + session cookie
- POST /api/auth/logout → {} → {ok}
- GET /api/auth/me → {} → {authenticated,authRequired}
- GET /api/health → {} → {ok,aiConfigured,transcriptionConfigured,whisperConfigured,model,feeds}
- GET /api/audio?url= → streams remote audio w/ Range (http→https proxy)
- GET /api/lessons/:id/audio → frozen KV MP3 w/ Range → 206/200
- GET /api/lessons → {lessons,activityLog}
- GET /api/stats → {activityLog}
- POST /api/lessons/sync → {} → {added,lessons} (fetch RSS x15)
- POST /api/lessons/custom → {title,audioUrl,transcript} → {lesson,lessons}
- PATCH /api/lessons/:id/progress → {lastPositionSec,addBookmarkSec,durationSec,listenDeltaSec,quizCompleted?} → {lesson,activityLog}
- POST /api/lessons/:id/transcribe → {durationSec} → {lesson,cached}
- POST /api/lessons/:id/prepare → {durationSec} → {lesson,cached?} (transcript + AI pack)
- POST /api/lessons/:id/output-feedback → {userText} → {lesson,feedback}
- POST /api/lessons/:id/align → {durationSec} → {lesson,cached} (estimate timings)
- POST /api/lessons/:lessonId/segments/:segmentId/explain → {} → {explanationFa,cached}
- GET /api/vocab → {vocab}
- POST /api/vocab → {word,contextSentence,meaningFa} → {item,vocab} 201
- POST /api/vocab/define → {word,contextSentence} → {item,vocab} (AI define)
- POST /api/vocab/:id/review → {rating:'again'|'good'|'easy'} → {item,vocab,activityLog}
- DELETE /api/vocab/:id → {} → {vocab}
- GET * → SPA fallback (index.html)

## Frontend Flow
- `App.tsx` state: lessons, vocab, activityLog, auth{checked,required,authenticated}, player{playing,currentTime,duration,rate}, booted/fatal, syncing, preparingId, addOpen, toast, aiConfigured, transcriptionConfigured.
- Audio engine: one persistent `<audio ref=audioRef>`; src swaps live-feed proxy → frozen KV on audioCached; refs track currentId, pendingSeek, media state; 5s auto-save + pagehide flush; Media Session for car/headset.
- Routing: `web/src/router.tsx` parsePath/useRoutePath; routes `/`, `/lesson/:id`, `/lesson/:id/drive`, `/vocab`.
- Components: `LessonList` library+sync, `StudyMode` transcript/AI pack, `DrivingMode` minimal car UI, `VocabList` SRS review, `LoginScreen` passcode, `AddLessonModal` custom lesson.

## Gotchas / Rules
- KV: one `audiolang_store` blob — every write is full-DB read→mutate→put (`update`). Frozen audio separate key `audio:${id}`.
- Auth: `APP_PASSCODE` unset = disabled (local only); secrets via `.dev.vars` (local) / `wrangler secret put` (prod). Never commit.
- Cache hits: transcribe/prepare/explain return `cached:true` at zero AI cost — check `transcriptVersion`, `audioCached`, `aiPack`, `explanationFa`.
- Never read in full: `node_modules/`, `dist/`, `package-lock.json`, `audiolang.diff`, `data/store.json`.
