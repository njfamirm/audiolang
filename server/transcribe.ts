import type { Env } from './env'

/**
 * Full transcript + sentence timings, powered by Cloudflare Workers AI
 * (`@cf/openai/whisper-large-v3-turbo`). No external STT provider or key:
 * the `AI` binding is all that is required. Cached in KV per lesson.
 */

/** A single spoken word with its own start/end, used to highlight along the audio. */
export interface WordTiming {
  text: string
  start: number
  end: number
}

export interface TranscriptSegment {
  text: string
  start: number
  end: number
  /** Word-level timings inside this sentence (real when Whisper provided them, else spread). */
  words?: WordTiming[]
}

export interface TranscriptResult {
  segments: TranscriptSegment[]
  /** True when timings were estimated (word-count distribution), not spoken timings. */
  timingApprox: boolean
  /** The exact MP3 bytes that were sent to Whisper, so they can be frozen in KV. */
  audio: ArrayBuffer
}

type TranscriptCore = Omit<TranscriptResult, 'audio'>

const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo'
/** Raw audio cap. Base64 inflates by ~33%, so stay well below request limits. */
const MAX_AUDIO_BYTES = 18 * 1024 * 1024

interface WhisperSegment {
  start?: number
  end?: number
  text?: string
}

interface WhisperWord {
  word?: string
  start?: number
  end?: number
}

interface WhisperResponse {
  text?: string
  segments?: WhisperSegment[]
  /** WebVTT transcript, present on some Whisper variants even when segments are not. */
  vtt?: string
  /** Word-level timings, present on some Whisper variants. */
  words?: WhisperWord[]
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

/** Parse `HH:MM:SS.mmm` / `MM:SS.mmm` / `SS.mmm` into seconds. */
function parseTimestamp(value: string): number {
  const parts = value.trim().split(':')
  if (parts.length === 0 || parts.some((part) => part === '' || Number.isNaN(Number(part)))) {
    return Number.NaN
  }
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + Number(part)
  return seconds
}

/** Parse WebVTT cues (`HH:MM:SS.mmm --> HH:MM:SS.mmm`) into timestamped segments. */
function parseVtt(vtt: string): TranscriptSegment[] {
  const cues: TranscriptSegment[] = []
  let current: { start: number; end: number; lines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const text = current.lines.join(' ').replace(/\s+/g, ' ').trim()
    if (text && Number.isFinite(current.start) && Number.isFinite(current.end)) {
      cues.push({ text, start: current.start, end: current.end })
    }
    current = null
  }

  for (const rawLine of vtt.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim()
    if (line.includes('-->')) {
      flush()
      const [startRaw, endRaw = ''] = line.split('-->')
      current = {
        start: parseTimestamp(startRaw),
        // Cue settings (align/position) can follow the end timestamp — keep only the time.
        end: parseTimestamp(endRaw.trim().split(/\s+/)[0] ?? ''),
        lines: [],
      }
      continue
    }
    if (!current || !line || line === 'WEBVTT') continue
    current.lines.push(line)
  }
  flush()

  return cues
}

/** Group word-level timings into sentences on terminal punctuation, a long pause, or a size cap. */
function groupWords(words: WhisperWord[]): TranscriptSegment[] {
  const cleaned = words
    .map((word) => ({
      text: typeof word.word === 'string' ? word.word.trim() : '',
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter((word) => word.text.length > 0)

  const segments: TranscriptSegment[] = []
  let buffer: typeof cleaned = []

  const flush = () => {
    if (buffer.length === 0) return
    const text = buffer
      .map((word) => word.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) {
      segments.push({ text, start: buffer[0].start, end: buffer[buffer.length - 1].end })
    }
    buffer = []
  }

  for (const word of cleaned) {
    const previous = buffer[buffer.length - 1]
    if (previous && Number.isFinite(word.start) && Number.isFinite(previous.end) && word.start - previous.end > 1.2) {
      flush()
    }
    buffer.push(word)
    if (/[.!?]["')\]]?$/.test(word.text) || buffer.length >= 40) flush()
  }
  flush()

  return segments
}

/** Keep only well-formed word timings from Whisper, preserving order. */
function cleanWords(words: WhisperWord[] | undefined): WordTiming[] {
  if (!Array.isArray(words)) return []
  const cleaned: WordTiming[] = []
  for (const item of words) {
    const text = typeof item.word === 'string' ? item.word.trim() : ''
    if (!text) continue
    const start = Number(item.start)
    if (!Number.isFinite(start)) continue
    const end = Number(item.end)
    cleaned.push({ text, start, end: Number.isFinite(end) && end > start ? end : start + 0.2 })
  }
  return cleaned
}

/** Spread a sentence's words across its own span, weighted by length — used when timings are estimated. */
export function distributeWords(text: string, startSec: number, endSec: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const weights = tokens.map((token) => Math.max(1, token.replace(/[^A-Za-z0-9']/g, '').length))
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const span = Math.max(endSec - startSec, 0.2)
  let cursor = 0
  return tokens.map((token, index) => {
    const start = startSec + (cursor / total) * span
    cursor += weights[index]
    const end = startSec + (cursor / total) * span
    return { text: token, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) }
  })
}

/**
 * Attach word-level timings to every segment. Prefers Whisper's real word timings when enough of
 * them fall inside the sentence; otherwise spreads the sentence's words across its own span so the
 * player can still highlight word by word.
 */
function attachWords(segments: TranscriptSegment[], words: WordTiming[]): TranscriptSegment[] {
  return segments.map((segment) => {
    const tokens = segment.text.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return segment

    if (words.length > 0) {
      const matched = words.filter((word) => {
        const middle = (word.start + word.end) / 2
        return middle >= segment.start - 0.05 && middle <= segment.end + 0.05
      })
      // Trust the match only when it accounts for a sensible share of the sentence.
      if (matched.length >= Math.max(1, Math.round(tokens.length * 0.5))) {
        return { ...segment, words: matched }
      }
    }

    return { ...segment, words: distributeWords(segment.text, segment.start, segment.end) }
  })
}

/** Clamp timings to the known duration and remove overlaps. */
function finalize(
  list: TranscriptSegment[],
  durationHintSec: number,
  timingApprox: boolean,
): TranscriptCore {
  const lastEnd = list.reduce(
    (max, item) => (Number.isFinite(item.end) ? Math.max(max, item.end) : max),
    0,
  )
  const duration = durationHintSec > 1 ? durationHintSec : lastEnd > 1 ? lastEnd : 0

  const segments = list.map((item) => {
    const start = Number.isFinite(item.start) ? item.start : 0
    const end = Number.isFinite(item.end) && item.end > start ? item.end : start + 0.6
    const clampedStart = duration > 0 ? Math.min(Math.max(start, 0), duration) : Math.max(start, 0)
    const clampedEnd = duration > 0 ? Math.min(Math.max(end, clampedStart), duration) : end
    return { text: item.text, start: clampedStart, end: clampedEnd }
  })

  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index].start < segments[index - 1].start) {
      segments[index].start = segments[index - 1].start
    }
    if (segments[index].end <= segments[index].start) {
      segments[index].end = segments[index].start + 0.6
    }
  }

  return {
    segments: segments.map((segment) => ({
      text: segment.text,
      start: Number(segment.start.toFixed(2)),
      end: Number(segment.end.toFixed(2)),
    })),
    timingApprox,
  }
}

function withWords(core: TranscriptCore, words: WordTiming[]): TranscriptCore {
  return { ...core, segments: attachWords(core.segments, words) }
}

function sanitize(raw: WhisperResponse, durationHintSec: number): TranscriptCore {
  const words = cleanWords(raw?.words)

  // 1) The model's own sentence segments — preferred, most accurate.
  const fromSegments: TranscriptSegment[] = []
  for (const item of Array.isArray(raw?.segments) ? raw.segments : []) {
    const text = typeof item.text === 'string' ? item.text.trim().replace(/\s+/g, ' ') : ''
    if (!text) continue
    const start = Number(item.start)
    const end = Number(item.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    fromSegments.push({ text, start, end })
  }
  if (fromSegments.length > 0) {
    return withWords(finalize(fromSegments, durationHintSec, false), words)
  }

  // 2) WebVTT cues carry the same spoken timings.
  if (typeof raw?.vtt === 'string' && raw.vtt.trim()) {
    const fromVtt = parseVtt(raw.vtt)
    if (fromVtt.length > 0) return withWords(finalize(fromVtt, durationHintSec, false), words)
  }

  // 3) Word-level timings grouped into sentences.
  const fromWords = groupWords(Array.isArray(raw?.words) ? raw.words : [])
  if (fromWords.length > 0) {
    return withWords(finalize(fromWords, durationHintSec, false), words)
  }

  // 4) Last resort: split the plain transcript and spread it evenly (clearly estimated).
  const text = typeof raw?.text === 'string' ? raw.text : ''
  const sentences = splitSentences(text)
  if (sentences.length === 0) {
    throw new Error('The model returned no transcript for this audio.')
  }
  const duration = durationHintSec > 1 ? durationHintSec : wordCount(text) / 2.5 || 60
  return withWords(
    { segments: distributeByLength(sentences, duration), timingApprox: true },
    words,
  )
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

  return { ...sanitize(result, durationHintSec), audio }
}
