import initialStore from '../data/store.json'
import { randomUUID } from './crypto'
import type { Env } from './env'
import type { WordTiming } from './transcribe'

/**
 * Cloudflare KV persistence layer.
 * The whole database is one JSON string under a single key.
 */

export interface ExplanationFa {
  meaning: string
  grammar: string
  idioms: string[]
  /** A simpler A2/B1 English paraphrase of the sentence. */
  simpleEnglish?: string
}

/** A single warm-up phrase with its short Persian meaning. */
export interface WarmupItem {
  phrase: string
  meaningFa: string
  note?: string
}

/** A single comprehension question with 4 options. */
export interface QuizItem {
  question: string
  options: string[]
  correctIndex: number
  explanationFa: string
}

/** On-demand AI lesson pack (warm-up, quiz and output prompt). */
export interface AiPack {
  warmup: WarmupItem[]
  quiz: QuizItem[]
  outputPrompt: string
}

/** Last on-demand output-writing feedback for the lesson. */
export interface OutputFeedback {
  userText: string
  nativeVersion: string
  feedbackFa: string
}

export interface Segment {
  id: string
  index: number
  /** A single English sentence. */
  text: string
  /** Start of the sentence in the audio (seconds), from Whisper. */
  startSec?: number
  /** End of the sentence in the audio (seconds), from Whisper. */
  endSec?: number
  /** Word-level timings inside this sentence, for word-by-word highlighting. */
  words?: WordTiming[]
  /** Cached AI response. `undefined`/`null` until requested once. */
  explanationFa?: ExplanationFa | null
}

export interface Lesson {
  id: string
  title: string
  /** e.g. "BBC 6 Minute English" | "VOA Learning English" | "Custom" */
  source: string
  audioUrl: string
  publishedAt: string
  lastPositionSec: number
  /** Timestamps (seconds) bookmarked while driving. */
  bookmarks: number[]
  segments: Segment[]
  /** True once the full transcript with timestamps has been stored. */
  transcribed?: boolean
  /** True once the exact transcribed MP3 bytes are frozen in KV (prevents audio/transcript drift). */
  audioCached?: boolean
  /** True when sentence timings were estimated rather than spoken precisely. */
  timingApprox?: boolean
  /** Transcript pipeline version (older lessons upgraded to 2 on-demand). */
  transcriptVersion?: number
  /** Estimated CEFR level of the episode (e.g. "B1+"). */
  cefrLevel?: string
  /** Default level band of the RSS source (e.g. "B1–B2"). */
  sourceLevel?: string
  /** Audio length in seconds. */
  durationSec?: number
  /** 2-3 word English topic of the episode. */
  topic?: string
  /** Cached on-demand AI lesson pack. Null until generated once. */
  aiPack?: AiPack | null
  /** True once the comprehension quiz has been completed. */
  quizCompleted?: boolean
  /** True once the output-writing task has been completed. */
  outputCompleted?: boolean
  /** Last cached output-writing feedback. Null until requested once. */
  lastOutputFeedback?: OutputFeedback | null
}

export interface VocabItem {
  id: string
  word: string
  contextSentence: string
  meaningFa: string
  createdAt: string
  /** Spaced-repetition stage. */
  stage?: 'new' | 'learning' | 'mastered'
  /** Next review timestamp (ISO). */
  nextReviewAt?: string
  /** Current review interval in days. */
  intervalDays?: number
  /** Consecutive correct reviews. */
  correctStreak?: number
}

/** Per-day activity counters, keyed by `YYYY-MM-DD`. */
export interface ActivityLogEntry {
  listenSec: number
  reviews: number
}

export interface Store {
  lessons: Lesson[]
  vocab: VocabItem[]
  activityLog?: Record<string, ActivityLogEntry>
}

export const STORE_KEY = 'audiolang_store'

function normalize(raw: unknown): Store {
  const data = (raw ?? {}) as Partial<Store>
  const lessons = Array.isArray(data.lessons) ? data.lessons : []
  const vocab = Array.isArray(data.vocab) ? data.vocab : []
  const activityLog =
    data.activityLog && typeof data.activityLog === 'object' ? data.activityLog : {}
  for (const lesson of lessons) {
    if (!Array.isArray(lesson.bookmarks)) lesson.bookmarks = []
    if (!Array.isArray(lesson.segments)) lesson.segments = []
    if (typeof lesson.lastPositionSec !== 'number') lesson.lastPositionSec = 0
    if (typeof lesson.transcribed !== 'boolean') lesson.transcribed = false
    if (typeof lesson.audioCached !== 'boolean') lesson.audioCached = false
    if (typeof lesson.transcriptVersion !== 'number') lesson.transcriptVersion = 1
    if (typeof lesson.quizCompleted !== 'boolean') lesson.quizCompleted = false
    if (typeof lesson.outputCompleted !== 'boolean') lesson.outputCompleted = false
    if (typeof lesson.aiPack === 'undefined') lesson.aiPack = null
    if (typeof lesson.lastOutputFeedback === 'undefined') lesson.lastOutputFeedback = null
  }
  const nowIso = new Date().toISOString()
  for (const item of vocab) {
    if (item.stage !== 'new' && item.stage !== 'learning' && item.stage !== 'mastered') {
      item.stage = 'new'
    }
    if (typeof item.intervalDays !== 'number') item.intervalDays = 0
    if (typeof item.correctStreak !== 'number') item.correctStreak = 0
    if (typeof item.nextReviewAt !== 'string') item.nextReviewAt = nowIso
  }
  return { lessons, vocab, activityLog }
}

export async function load(env: Env): Promise<Store> {
  const raw = await env.STORE_KV.get(STORE_KEY, 'text')
  if (raw === null || raw === '') {
    // First boot: seed from the bundled fixture so the app is usable immediately.
    const seeded = normalize(structuredClone(initialStore))
    await save(env, seeded)
    return seeded
  }
  try {
    return normalize(JSON.parse(raw))
  } catch {
    return { lessons: [], vocab: [] }
  }
}

export async function save(env: Env, store: Store): Promise<void> {
  await env.STORE_KV.put(STORE_KEY, JSON.stringify(store))
}

/** Mutate the store in place and persist it. */
export async function update<T>(
  env: Env,
  mutator: (store: Store) => T | Promise<T>,
): Promise<T> {
  const store = await load(env)
  const result = await mutator(store)
  await save(env, store)
  return result
}

export function findLesson(store: Store, id: string): Lesson | undefined {
  return store.lessons.find((lesson) => lesson.id === id)
}

export function findVocabById(store: Store, id: string): VocabItem | undefined {
  return store.vocab.find((item) => item.id === id)
}

/** Local `YYYY-MM-DD` key for the activity log. */
export function todayKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Mutate the day's activity counters in place and return the entry. */
export function bumpActivity(
  store: Store,
  patch: { listenSec?: number; reviews?: number },
  key = todayKey(),
): ActivityLogEntry {
  if (!store.activityLog) store.activityLog = {}
  const entry = store.activityLog[key] ?? { listenSec: 0, reviews: 0 }
  if (patch.listenSec) entry.listenSec += patch.listenSec
  if (patch.reviews) entry.reviews += patch.reviews
  store.activityLog[key] = entry
  return entry
}

/** Case-insensitive vocabulary lookup. */
export function findVocab(store: Store, word: string): VocabItem | undefined {
  const needle = word.trim().toLowerCase()
  return store.vocab.find((item) => item.word.trim().toLowerCase() === needle)
}

/**
 * Insert a word or update the existing (case-insensitive) entry in place.
 * Returns the stored item; `store.vocab` is kept de-duplicated.
 */
export function upsertVocab(
  store: Store,
  payload: { word: string; contextSentence: string; meaningFa: string },
): VocabItem {
  const word = payload.word.trim()
  const existing = findVocab(store, word)
  if (existing) {
    if (payload.meaningFa.trim()) existing.meaningFa = payload.meaningFa.trim()
    if (payload.contextSentence.trim()) existing.contextSentence = payload.contextSentence.trim()
    return existing
  }
  const item: VocabItem = {
    id: randomUUID(),
    word,
    contextSentence: payload.contextSentence.trim(),
    meaningFa: payload.meaningFa.trim(),
    createdAt: new Date().toISOString(),
    stage: 'new',
    nextReviewAt: new Date().toISOString(),
    intervalDays: 0,
    correctStreak: 0,
  }
  store.vocab.unshift(item)
  return item
}