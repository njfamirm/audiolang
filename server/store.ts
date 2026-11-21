import initialStore from '../data/store.json'
import type { Env } from './env'

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