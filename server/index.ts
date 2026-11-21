import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { currentModel, explainSentence, hasApiKey } from './ai'
import { randomUUID } from './crypto'
import type { Env } from './env'
import { FEEDS, buildSegments, fetchEpisodes } from './rss'
import {
  findLesson,
  load,
  update,
  type Lesson,
  type Segment,
  type VocabItem,
} from './store'
import { transcribeAudio, transcriptionConfigured } from './transcribe'

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

app.onError((error, c) => {
  console.error('[api]', error)
  return c.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
})

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    aiConfigured: hasApiKey(c.env),
    transcriptionConfigured: transcriptionConfigured(c.env),
    whisperConfigured: Boolean(c.env.AI),
    model: currentModel(c.env),
    feeds: FEEDS.map((feed) => feed.source),
  }),
)

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

app.get('/api/lessons', async (c) => {
  const store = await load(c.env)
  return c.json({ lessons: store.lessons })
})

app.post('/api/lessons/sync', async (c) => {
  const fetched = await fetchEpisodes(5)
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
  const body = await c.req.json<{ lastPositionSec?: number; addBookmarkSec?: number }>()

  const lesson = await update(c.env, (store) => {
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
    return target
  })

  if (!lesson) return c.json({ error: 'Lesson not found' }, 404)
  return c.json({ lesson })
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

  // Cache hit: the full timestamped transcript is already stored. Zero cost.
  if (lesson.transcribed) {
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

  const updated = await update(c.env, (current) => {
    const target = findLesson(current, id)
    if (!target) return null
    const segments: Segment[] = result.segments.map((segment, index) => ({
      id: randomUUID(),
      index,
      text: segment.text,
      startSec: segment.start,
      endSec: segment.end,
      explanationFa: null,
    }))
    target.segments = segments
    target.transcribed = true
    target.timingApprox = result.timingApprox
    return target
  })

  if (!updated) return c.json({ error: 'Lesson not found' }, 404)
  return c.json({ lesson: updated, cached: false })
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
      return {
        ...segment,
        startSec: Number(start.toFixed(2)),
        endSec: Number(end.toFixed(2)),
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

  const item: VocabItem = {
    id: randomUUID(),
    word,
    contextSentence: body.contextSentence?.trim() ?? '',
    meaningFa: body.meaningFa?.trim() ?? '',
    createdAt: new Date().toISOString(),
  }

  const vocab = await update(c.env, (store) => {
    store.vocab.unshift(item)
    return store.vocab
  })
  return c.json({ item, vocab }, 201)
})

app.delete('/api/vocab/:id', async (c) => {
  const id = c.req.param('id')
  const vocab = await update(c.env, (store) => {
    store.vocab = store.vocab.filter((item) => item.id !== id)
    return store.vocab
  })
  return c.json({ vocab })
})

export default app