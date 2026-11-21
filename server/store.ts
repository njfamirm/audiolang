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
}

export interface VocabItem {
  id: string
  word: string
  contextSentence: string
  meaningFa: string
  createdAt: string
}

export interface Store {
  lessons: Lesson[]
  vocab: VocabItem[]
}

export const STORE_KEY = 'audiolang_store'

function normalize(raw: unknown): Store {
  const data = (raw ?? {}) as Partial<Store>
  const lessons = Array.isArray(data.lessons) ? data.lessons : []
  const vocab = Array.isArray(data.vocab) ? data.vocab : []
  for (const lesson of lessons) {
    if (!Array.isArray(lesson.bookmarks)) lesson.bookmarks = []
    if (!Array.isArray(lesson.segments)) lesson.segments = []
    if (typeof lesson.lastPositionSec !== 'number') lesson.lastPositionSec = 0
    if (typeof lesson.transcribed !== 'boolean') lesson.transcribed = false
    if (typeof lesson.audioCached !== 'boolean') lesson.audioCached = false
  }
  return { lessons, vocab }
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
  }
  store.vocab.unshift(item)
  return item
}