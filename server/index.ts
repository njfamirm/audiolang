import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  WORKERS_AI_MODEL,
  defineWord,
  explainSentence,
  generateLessonPack,
  reviewOutput,
} from './ai'
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  isAuthRequired,
  signToken,
  validatePasscode,
  verifyToken,
} from './auth'
import { randomUUID } from './crypto'
import type { Env } from './env'
import { FEEDS, buildSegments, fetchEpisodes } from './rss'
import {
  bumpActivity,
  findLesson,
  findVocabById,
  load,
  update,
  upsertVocab,
  type Lesson,
  type Segment,
} from './store'
import {
  CURRENT_TRANSCRIPT_VERSION,
  distributeWords,
  transcribeAudio,
  transcribeBuffer,
  transcriptionConfigured,
} from './transcribe'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

/** Routes that stay reachable without a session. Everything else under /api needs one. */
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/health',
])

app.use('/api/*', async (c, next) => {
  if (!isAuthRequired(c.env)) return next()
  if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) return next()
  const token = getCookie(c, SESSION_COOKIE)
  if (!(await verifyToken(c.env, token))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
})

app.onError((error, c) => {
  console.error('[api]', error)
  return c.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
})

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    // Explanations and definitions run on Workers AI, with a Groq (then OpenRouter) fallback.
    aiConfigured: Boolean(c.env.AI) || Boolean(c.env.GROQ_API_KEY) || Boolean(c.env.OPENROUTER_API_KEY),
    transcriptionConfigured: transcriptionConfigured(c.env),
    whisperConfigured: Boolean(c.env.AI),
    model: WORKERS_AI_MODEL,
    feeds: FEEDS.map((feed) => feed.source),
  }),
)

// --- Auth ---

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ passcode?: string }>().catch(() => ({ passcode: '' }))
  const passcode = (body.passcode ?? '').trim()

  if (!validatePasscode(c.env, passcode)) {
    return c.json({ error: 'Incorrect passcode' }, 401)
  }

  if (isAuthRequired(c.env)) {
    setCookie(c, SESSION_COOKIE, await signToken(c.env), {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }
  return c.json({ ok: true })
})

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/auth/me', async (c) => {
  const required = isAuthRequired(c.env)
  const token = getCookie(c, SESSION_COOKIE)
  const authenticated = !required || (await verifyToken(c.env, token))
  return c.json({ authenticated, authRequired: required })
})


/**
 * Same-origin audio proxy. Podcast feeds (e.g. BBC) hand out `http://` media
 * URLs that redirect to more `http://` hosts; an HTTPS page cannot play those
 * (mixed content). We fetch server-side and stream back over HTTPS, forwarding
 * Range requests so seeking keeps working.
 */
app.get('/api/audio', async (c) => {
  const raw = c.req.query('url')
  if (!raw) return c.json({ error: 'url is required' }, 400)

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return c.json({ error: 'Invalid url' }, 400)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return c.json({ error: 'Only http(s) audio is allowed' }, 400)
  }

  const requestHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; AudioLang/2.0; +cloudflare-worker)',
    Accept: '*/*',
  }
  const range = c.req.header('range')
  if (range) requestHeaders.Range = range

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), { redirect: 'follow', headers: requestHeaders })
  } catch {
    return c.json({ error: 'Could not reach the audio source.' }, 502)
  }
  if (!upstream.ok && upstream.status !== 206) {
    return c.json({ error: `Audio source returned HTTP ${upstream.status}.` }, 502)
  }

  const headers = new Headers()
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes')
  if (!headers.has('content-type')) headers.set('content-type', 'audio/mpeg')
  headers.set('cache-control', 'public, max-age=3600')

  return new Response(upstream.body, { status: upstream.status, headers })
})

/** Parse a single `Range` header into an offset/length slice, or null when unsatisfiable. */
function parseRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, startRaw, endRaw] = match
  if (startRaw === '' && endRaw === '') return null

  let start: number
  let end: number
  if (startRaw === '') {
    const suffix = Number(endRaw)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(startRaw)
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { offset: start, length: end - start + 1 }
}

/**
 * Frozen audio: stream the exact MP3 bytes that were transcribed, stored in KV, with byte-range
 * support so seeking works reliably on mobile Chrome/Safari and in the car.
 */
app.get('/api/lessons/:id/audio', async (c) => {
  const id = c.req.param('id')
  const rangeHeader = c.req.header('range')

  const audio = await c.env.STORE_KV.get(`audio:${id}`, { type: 'arrayBuffer' })
  if (!audio || audio.byteLength === 0) {
    return c.json({ error: 'Audio not found for this lesson.' }, 404)
  }

  const size = audio.byteLength
  const headers = new Headers()
  headers.set('Content-Type', 'audio/mpeg')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=86400')
  headers.set('ETag', `"${id}-${size}"`)

  if (rangeHeader) {
    const range = parseRange(rangeHeader, size)
    if (!range) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`)
    headers.set('Content-Length', String(range.length))
    return new Response(audio.slice(range.offset, range.offset + range.length), {
      status: 206,
      headers,
    })
  }

  headers.set('Content-Length', String(size))
  return new Response(audio, { status: 200, headers })
})

app.get('/api/lessons', async (c) => {
  const store = await load(c.env)
  return c.json({ lessons: store.lessons, activityLog: store.activityLog ?? {} })
})

/** Daily activity counters for the 30-day heatmap and streak. */
app.get('/api/stats', async (c) => {
  const store = await load(c.env)
  return c.json({ activityLog: store.activityLog ?? {} })
})

app.post('/api/lessons/sync', async (c) => {
  const fetched = await fetchEpisodes(15)
  const result = await update(c.env, (current) => {
    const existing = new Set(current.lessons.map((lesson) => lesson.audioUrl))
    let added = 0
    for (const lesson of fetched) {
      if (existing.has(lesson.audioUrl)) continue
      existing.add(lesson.audioUrl)
      current.lessons.unshift(lesson)
      added += 1
    }
    return { added, lessons: current.lessons }
  })
  return c.json(result)
})

app.post('/api/lessons/custom', async (c) => {
  const body = await c.req.json<{ title?: string; audioUrl?: string; transcript?: string }>()
  const title = body.title?.trim()
  const audioUrl = body.audioUrl?.trim()
  const transcript = body.transcript?.trim()

  if (!title || !audioUrl || !transcript) {
    return c.json({ error: 'title, audioUrl and transcript are required' }, 400)
  }

  const segments = buildSegments(transcript, 200)
  if (segments.length === 0) {
    return c.json({ error: 'Could not split the transcript into sentences' }, 400)
  }

  const lesson: Lesson = {
    id: randomUUID(),
    title,
    source: 'Custom',
    audioUrl,
    publishedAt: new Date().toISOString(),
    lastPositionSec: 0,
    bookmarks: [],
    segments,
    transcribed: false,
  }

  const lessons = await update(c.env, (current) => {
    current.lessons.unshift(lesson)
    return current.lessons
  })
  return c.json({ lesson, lessons }, 201)
})

app.patch('/api/lessons/:id/progress', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    lastPositionSec?: number
    addBookmarkSec?: number
    durationSec?: number
    listenDeltaSec?: number
    quizCompleted?: boolean
  }>()

  const result = await update(c.env, (store) => {
    const target = findLesson(store, id)
    if (!target) return null
    if (typeof body.lastPositionSec === 'number' && Number.isFinite(body.lastPositionSec)) {
      target.lastPositionSec = Math.max(0, Math.round(body.lastPositionSec))
    }
    if (typeof body.addBookmarkSec === 'number' && Number.isFinite(body.addBookmarkSec)) {
      const mark = Math.max(0, Math.round(body.addBookmarkSec))
      if (!target.bookmarks.includes(mark)) {
        target.bookmarks.push(mark)
        target.bookmarks.sort((a, b) => a - b)
      }
    }
    if (typeof body.durationSec === 'number' && Number.isFinite(body.durationSec)) {
      target.durationSec = Math.max(0, Math.round(body.durationSec))
    }
    if (typeof body.quizCompleted === 'boolean') {
      target.quizCompleted = body.quizCompleted
    }
    if (typeof body.listenDeltaSec === 'number' && Number.isFinite(body.listenDeltaSec)) {
      const delta = Math.max(0, Math.round(body.listenDeltaSec))
      if (delta > 0) bumpActivity(store, { listenSec: delta })
    }
    return { lesson: target, activityLog: store.activityLog ?? {} }
  })

  if (!result) return c.json({ error: 'Lesson not found' }, 404)
  return c.json(result)
})

app.post('/api/lessons/:id/transcribe', async (c) => {
  const id = c.req.param('id')
  const body = await c.req
    .json<{ durationSec?: number }>()
    .catch(() => ({}) as { durationSec?: number })
  const durationSec =
    typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) ? body.durationSec : 0

  const store = await load(c.env)
  const lesson = findLesson(store, id)
  if (!lesson) return c.json({ error: 'Lesson not found' }, 404)

  // Cache hit: transcript + frozen audio already stored at the current version. Zero AI cost.
  if (
    lesson.transcribed &&
    lesson.audioCached &&
    (lesson.transcriptVersion ?? 1) >= CURRENT_TRANSCRIPT_VERSION
  ) {
    return c.json({ lesson, cached: true })
  }

  if (!transcriptionConfigured(c.env)) {
    return c.json(
      {
        error:
          'Workers AI is not configured. Add the `[ai]` binding block to wrangler.toml and deploy again.',
      },
      400,
    )
  }

  let result
  try {
    result = await transcribeAudio(c.env, lesson.audioUrl, durationSec)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Transcription failed' },
      502,
    )
  }

  if (result.segments.length === 0) {
    return c.json({ error: 'The model returned no speech segments for this audio.' }, 502)
  }

  // Freeze the exact bytes that were sent to Whisper so playback and timestamps never drift
  // (BBC-style dynamic ad insertion serves different ad lengths on each request).
  let audioCached = true
  try {
    await c.env.STORE_KV.put(`audio:${id}`, result.audio)
    if (c.env.AUDIO_BUCKET) {
      await c.env.AUDIO_BUCKET.put(`lessons/${id}.mp3`, result.audio)
    }
  } catch (error) {
    audioCached = false
    console.error('[kv] Could not freeze audio:', error)
  }

  const updated = await update(c.env, (current) => {
    const target = findLesson(current, id)
    if (!target) return null
    const segments: Segment[] = result.segments.map((segment, index) => ({
      id: randomUUID(),
      index,
      text: segment.text,
      startSec: segment.start,
      endSec: segment.end,
      words: segment.words,
      explanationFa: null,
    }))
    target.segments = segments
    target.transcribed = true
    target.audioCached = audioCached
    target.timingApprox = result.timingApprox
    target.transcriptVersion = CURRENT_TRANSCRIPT_VERSION
    return target
  })

  if (!updated) return c.json({ error: 'Lesson not found' }, 404)
  return c.json({ lesson: updated, cached: false })
})

/**
 * On-demand "prepare" for a single lesson: transcribe (with sentence merging) and generate the
 * AI lesson pack, cached so later visits cost zero AI. Nothing is generated during RSS sync.
 */
app.post('/api/lessons/:id/prepare', async (c) => {
  const id = c.req.param('id')
  const body = await c.req
    .json<{ durationSec?: number }>()
    .catch(() => ({}) as { durationSec?: number })
  const durationSec =
    typeof body.durationSec === 'number' && Number.isFinite(body.durationSec) ? body.durationSec : 0

  const store = await load(c.env)
  const lesson = findLesson(store, id)
  if (!lesson) return c.json({ error: 'Lesson not found' }, 404)

  const version = lesson.transcriptVersion ?? 1
  const needsTranscript =
    !lesson.transcribed || !lesson.audioCached || version < CURRENT_TRANSCRIPT_VERSION
  const needsPack = !lesson.aiPack

  if (!needsTranscript && !needsPack) {
    return c.json({ lesson, cached: true })
  }

  if (needsTranscript && !transcriptionConfigured(c.env)) {
    return c.json(
      {
        error:
          'Workers AI is not configured. Add the `[ai]` binding block to wrangler.toml and deploy again.',
      },
      400,
    )
  }

  // Step A: use the frozen MP3 when available (R2 first, then KV); otherwise download + freeze.
  let transcript: Awaited<ReturnType<typeof transcribeBuffer>> | null = null
  if (needsTranscript) {
    let audio: ArrayBuffer | null = null
    if (lesson.audioCached) {
      if (c.env.AUDIO_BUCKET) {
        const object = await c.env.AUDIO_BUCKET.get(`lessons/${id}.mp3`)
        if (object) audio = await object.arrayBuffer()
      }
      if (!audio) {
        audio = await c.env.STORE_KV.get(`audio:${id}`, { type: 'arrayBuffer' })
      }
    }
    try {
      transcript =
        audio && audio.byteLength > 0
          ? await transcribeBuffer(c.env, audio, durationSec)
          : await transcribeAudio(c.env, lesson.audioUrl, durationSec)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Transcription failed' },
        502,
      )
    }
    if (transcript.segments.length === 0) {
      return c.json({ error: 'The model returned no speech segments for this audio.' }, 502)
    }
  }

  // Freeze the exact bytes that were transcribed so playback and timestamps never drift.
  let audioCached = lesson.audioCached ?? false
  if (transcript) {
    audioCached = false
    try {
      await c.env.STORE_KV.put(`audio:${id}`, transcript.audio)
      if (c.env.AUDIO_BUCKET) {
        await c.env.AUDIO_BUCKET.put(`lessons/${id}.mp3`, transcript.audio)
      }
      audioCached = true
    } catch (error) {
      console.error('[prepare] could not freeze audio:', error)
    }
  }

  // Persist transcript + lesson pack in a single KV write.
  const updated = await update(c.env, async (current) => {
    const target = findLesson(current, id)
    if (!target) return null

    if (transcript) {
      target.segments = transcript.segments.map((segment, index) => ({
        id: randomUUID(),
        index,
        text: segment.text,
        startSec: segment.start,
        endSec: segment.end,
        words: segment.words,
        explanationFa: null,
      }))
      target.transcribed = true
      target.audioCached = audioCached
      target.timingApprox = transcript.timingApprox
      target.transcriptVersion = CURRENT_TRANSCRIPT_VERSION
      if (durationSec > 0) target.durationSec = Math.round(durationSec)
    }

    // Step B: on-demand lesson pack (skipped when already cached).
    if (!target.aiPack) {
      const fullText = target.segments.map((segment) => segment.text).join(' ')
      try {
        const pack = await generateLessonPack(c.env, target.title, fullText)
        target.aiPack = { warmup: pack.warmup, quiz: pack.quiz, outputPrompt: pack.outputPrompt }
        target.cefrLevel = pack.cefrLevel
        target.topic = pack.topic
      } catch (error) {
        console.error('[prepare] lesson pack failed:', error)
      }
    }
    return target
  })

  if (!updated) return c.json({ error: 'Lesson not found' }, 404)
  return c.json({ lesson: updated })
})

/** Review the learner's written output and cache the feedback on the lesson. */
app.post('/api/lessons/:id/output-feedback', async (c) => {
  const id = c.req.param('id')
  const body = await c.req
    .json<{ userText?: string }>()
    .catch(() => ({}) as { userText?: string })
  const userText = body.userText?.trim()
  if (!userText) return c.json({ error: 'userText is required' }, 400)

  const store = await load(c.env)
  const lesson = findLesson(store, id)
  if (!lesson) return c.json({ error: 'Lesson not found' }, 404)

  const prompt = lesson.aiPack?.outputPrompt ?? `Talk about this episode: ${lesson.title}`

  let feedback: { nativeVersion: string; feedbackFa: string }
  try {
    feedback = await reviewOutput(c.env, lesson.title, prompt, userText)
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not review this answer' },
      502,
    )
  }

  const result = await update(c.env, (current) => {
    const target = findLesson(current, id)
    if (!target) return null
    target.lastOutputFeedback = {
      userText,
      nativeVersion: feedback.nativeVersion,
      feedbackFa: feedback.feedbackFa,
    }
    target.outputCompleted = true
    return { lesson: target, feedback }
  })

  if (!result) return c.json({ error: 'Lesson not found' }, 404)
  return c.json(result)
})

app.post('/api/lessons/:id/align', async (c) => {
  const id = c.req.param('id')
  const body = await c.req
    .json<{ durationSec?: number }>()
    .catch(() => ({}) as { durationSec?: number })
  const duration = Number(body.durationSec)

  if (!Number.isFinite(duration) || duration <= 1) {
    return c.json({ error: 'durationSec must be the audio length in seconds.' }, 400)
  }

  const store = await load(c.env)
  const lesson = findLesson(store, id)
  if (!lesson) return c.json({ error: 'Lesson not found' }, 404)

  if (lesson.transcribed && lesson.segments.every((segment) => typeof segment.startSec === 'number')) {
    return c.json({ lesson, cached: true })
  }

  const updated = await update(c.env, (current) => {
    const target = findLesson(current, id)
    if (!target || target.segments.length === 0) return null

    const weights = target.segments.map((segment) =>
      Math.max(1, segment.text.split(/\s+/).filter(Boolean).length),
    )
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1

    let cursor = 0
    target.segments = target.segments.map((segment, index) => {
      const start = (cursor / total) * duration
      cursor += weights[index]
      const end = (cursor / total) * duration
      const startSec = Number(start.toFixed(2))
      const endSec = Number(end.toFixed(2))
      return {
        ...segment,
        startSec,
        endSec,
        words: distributeWords(segment.text, startSec, endSec),
      }
    })
    target.transcribed = true
    target.timingApprox = true
    return target
  })

  if (!updated) return c.json({ error: 'Lesson has no transcript to align.' }, 400)
  return c.json({ lesson: updated, cached: false })
})

app.post('/api/lessons/:lessonId/segments/:segmentId/explain', async (c) => {
  const lessonId = c.req.param('lessonId')
  const segmentId = c.req.param('segmentId')

  const store = await load(c.env)
  const lesson = findLesson(store, lessonId)
  if (!lesson) return c.json({ error: 'Lesson not found' }, 404)
  const segment = lesson.segments.find((item) => item.id === segmentId)
  if (!segment) return c.json({ error: 'Segment not found' }, 404)

  // Cache hit: zero API cost.
  if (segment.explanationFa) {
    return c.json({ explanationFa: segment.explanationFa, cached: true })
  }

  const explanationFa = await explainSentence(c.env, segment.text, lesson.title)
  await update(c.env, (current) => {
    const target = findLesson(current, lessonId)?.segments.find((item) => item.id === segmentId)
    if (target) target.explanationFa = explanationFa
  })

  return c.json({ explanationFa, cached: false })
})

app.get('/api/vocab', async (c) => {
  const store = await load(c.env)
  return c.json({ vocab: store.vocab })
})

app.post('/api/vocab', async (c) => {
  const body = await c.req.json<{ word?: string; contextSentence?: string; meaningFa?: string }>()
  const word = body.word?.trim()
  if (!word) return c.json({ error: 'word is required' }, 400)

  const result = await update(c.env, (store) => {
    const item = upsertVocab(store, {
      word,
      contextSentence: body.contextSentence ?? '',
      meaningFa: body.meaningFa ?? '',
    })
    return { item, vocab: store.vocab }
  })
  return c.json(result, 201)
})

/** Resolve a one-line Persian meaning via OpenRouter, then save it immediately. */
app.post('/api/vocab/define', async (c) => {
  const body = await c.req.json<{ word?: string; contextSentence?: string }>()
  const word = body.word?.trim()
  if (!word) return c.json({ error: 'word is required' }, 400)

  let meaningFa: string
  try {
    meaningFa = await defineWord(c.env, word, body.contextSentence?.trim() ?? '')
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Could not define this word' },
      502,
    )
  }

  const result = await update(c.env, (store) => {
    const item = upsertVocab(store, {
      word,
      contextSentence: body.contextSentence ?? '',
      meaningFa,
    })
    return { item, vocab: store.vocab }
  })
  return c.json(result, 201)
})

/** Record a spaced-repetition review and reschedule the item. */
app.post('/api/vocab/:id/review', async (c) => {
  const id = c.req.param('id')
  const body = await c.req
    .json<{ rating?: 'again' | 'good' | 'easy' }>()
    .catch(() => ({}) as { rating?: 'again' | 'good' | 'easy' })
  const rating = body.rating
  if (rating !== 'again' && rating !== 'good' && rating !== 'easy') {
    return c.json({ error: "rating must be 'again', 'good' or 'easy'" }, 400)
  }

  const DAY_MS = 24 * 60 * 60 * 1000
  const result = await update(c.env, (store) => {
    const item = findVocabById(store, id)
    if (!item) return null

    const now = Date.now()
    const streak = item.correctStreak ?? 0
    const interval = item.intervalDays ?? 0

    if (rating === 'again') {
      item.correctStreak = 0
      item.intervalDays = 0
      item.stage = 'learning'
      item.nextReviewAt = new Date(now + 10 * 60 * 1000).toISOString()
    } else if (rating === 'good') {
      item.correctStreak = streak + 1
      item.intervalDays = Math.max(1, (interval || 1) * 2)
      item.stage = item.correctStreak >= 3 ? 'mastered' : 'learning'
      item.nextReviewAt = new Date(now + item.intervalDays * DAY_MS).toISOString()
    } else {
      item.correctStreak = streak + 1
      item.intervalDays = Math.max(3, (interval || 1) * 3)
      item.stage = item.correctStreak >= 3 ? 'mastered' : 'learning'
      item.nextReviewAt = new Date(now + item.intervalDays * DAY_MS).toISOString()
    }

    bumpActivity(store, { reviews: 1 })
    return { item, vocab: store.vocab, activityLog: store.activityLog ?? {} }
  })

  if (!result) return c.json({ error: 'Vocabulary item not found' }, 404)
  return c.json(result)
})

app.delete('/api/vocab/:id', async (c) => {
  const id = c.req.param('id')
  const vocab = await update(c.env, (store) => {
    store.vocab = store.vocab.filter((item) => item.id !== id)
    return store.vocab
  })
  return c.json({ vocab })
})

/**
 * SPA fallback: serve built static assets, and hand any unknown non-API path to index.html so
 * client-side routes like `/lesson/:id` survive a hard reload or a shared deep link.
 */
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.notFound()
  const asset = await c.env.ASSETS.fetch(c.req.raw)
  if (asset.status !== 404) return asset
  return c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), c.req.raw))
})

export default app