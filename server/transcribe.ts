import type { Env } from './env'

/**
 * Full transcript + sentence timings, powered by Cloudflare Workers AI
 * (`@cf/openai/whisper-large-v3-turbo`). No external STT provider or key:
 * the `AI` binding is all that is required. Cached in KV per lesson.
 */

export interface TranscriptSegment {
  text: string
  start: number
  end: number
}

export interface TranscriptResult {
  segments: TranscriptSegment[]
  /** True when timings were estimated (word-count distribution), not spoken timings. */
  timingApprox: boolean
}

const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo'
/** Raw audio cap. Base64 inflates by ~33%, so stay well below request limits. */
const MAX_AUDIO_BYTES = 18 * 1024 * 1024

interface WhisperSegment {
  start?: number
  end?: number
  text?: string
}

interface WhisperResponse {
  text?: string
  segments?: WhisperSegment[]
}

export function transcriptionConfigured(env: Env): boolean {
  return Boolean(env.AI)
}

/** Base64-encode bytes in fixed-size chunks so huge MP3s never blow the call stack. */
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x2000 // 8192 bytes
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(parts.join(''))
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Split a plain transcript into sentences, distributing time by length. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function distributeByLength(texts: string[], duration: number): TranscriptSegment[] {
  const weights = texts.map((text) => Math.max(1, wordCount(text)))
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
  let cursor = 0
  return texts.map((text, index) => {
    const start = (cursor / total) * duration
    cursor += weights[index]
    const end = (cursor / total) * duration
    return { text, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) }
  })
}

function sanitize(raw: WhisperResponse, durationHintSec: number): TranscriptResult {
  const list = Array.isArray(raw?.segments) ? raw.segments : []

  const cleaned: TranscriptSegment[] = []
  for (const item of list) {
    const text = typeof item.text === 'string' ? item.text.trim().replace(/\s+/g, ' ') : ''
    if (!text) continue
    cleaned.push({
      text,
      start: Number(item.start ?? Number.NaN),
      end: Number(item.end ?? Number.NaN),
    })
  }

  // Fallback: no usable segments → split the plain transcript and spread it.
  if (cleaned.length === 0) {
    const text = typeof raw?.text === 'string' ? raw.text : ''
    const sentences = splitSentences(text)
    if (sentences.length === 0) {
      throw new Error('The model returned no transcript for this audio.')
    }
    const lastEnd = 0
    const duration = durationHintSec > 1 ? durationHintSec : wordCount(text) / 2.5 || lastEnd
    return { segments: distributeByLength(sentences, duration), timingApprox: true }
  }

  const lastEnd = cleaned.reduce(
    (max, item) => (Number.isFinite(item.end) ? Math.max(max, item.end) : max),
    0,
  )
  const duration =
    durationHintSec > 1
      ? durationHintSec
      : lastEnd > 1
        ? lastEnd
        : wordCount(cleaned.map((item) => item.text).join(' ')) / 2.5

  // Use the model's own timings only when they look internally consistent.
  const monotonic = cleaned.every(
    (item, index) => index === 0 || item.start >= cleaned[index - 1].start - 0.5,
  )
  const wellFormed = cleaned.every(
    (item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start,
  )
  const coversAudio = lastEnd >= duration * 0.75 && lastEnd <= duration * 1.15
  const plausible = monotonic && wellFormed && coversAudio

  if (!plausible) {
    return {
      segments: distributeByLength(
        cleaned.map((item) => item.text),
        duration,
      ),
      timingApprox: true,
    }
  }

  const segments = cleaned.map((item) => ({
    text: item.text,
    start: Number(Math.min(Math.max(item.start, 0), duration).toFixed(2)),
    end: Number(Math.min(Math.max(item.end, 0), duration).toFixed(2)),
  }))

  // Fix any remaining overlap introduced by clamping.
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].start < segments[index - 1].start) {
      segments[index].start = segments[index - 1].start
    }
    if (segments[index].end <= segments[index].start) {
      segments[index].end = Math.min(
        duration,
        segments[index].start + Math.max(0.6, (duration - segments[index].start) / 10),
      )
    }
  }

  return { segments, timingApprox: false }
}

export async function transcribeAudio(
  env: Env,
  audioUrl: string,
  durationHintSec = 0,
): Promise<TranscriptResult> {
  if (!env.AI) {
    throw new Error('The Workers AI binding (AI) is not configured. Add the [ai] block to wrangler.toml.')
  }

  const audioResponse = await fetch(audioUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AudioLang/2.0; +cloudflare-worker)' },
  })
  if (!audioResponse.ok) {
    throw new Error(`Could not download audio (HTTP ${audioResponse.status}).`)
  }

  const declaredLength = Number(audioResponse.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `This episode is ${Math.round(declaredLength / 1024 / 1024)} MB — too large to transcribe. Try a shorter audio URL.`,
    )
  }

  const audio = await audioResponse.arrayBuffer()
  if (audio.byteLength === 0) throw new Error('Audio download returned 0 bytes.')
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `This episode is ${Math.round(audio.byteLength / 1024 / 1024)} MB — too large to transcribe. Try a shorter audio URL.`,
    )
  }

  const audioBase64 = toBase64(new Uint8Array(audio))

  const result = (await env.AI.run(WHISPER_MODEL, {
    audio: audioBase64,
    task: 'transcribe',
    language: 'en',
  })) as WhisperResponse

  return sanitize(result, durationHintSec)
}
