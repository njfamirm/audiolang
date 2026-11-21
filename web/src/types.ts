export interface ExplanationFa {
  /** Natural Persian translation. */
  meaning: string
  /** Brief grammar note in Persian (1-2 sentences). */
  grammar: string
  /** Key idioms / phrases with Persian meaning. */
  idioms: string[]
}

/** A single spoken word with its own start/end, for word-by-word highlighting. */
export interface WordTiming {
  text: string
  start: number
  end: number
}

export interface Segment {
  id: string
  index: number
  /** Single English sentence. */
  text: string
  /** Start of the sentence in the audio (seconds), from Whisper. */
  startSec?: number
  /** End of the sentence in the audio (seconds), from Whisper. */
  endSec?: number
  /** Word-level timings inside this sentence, when available. */
  words?: WordTiming[]
  /** Cached AI response — null until requested. */
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
  /** True when sentence timings are estimated rather than precisely spoken. */
  timingApprox?: boolean
}

export interface VocabItem {
  id: string
  word: string
  contextSentence: string
  meaningFa: string
  createdAt: string
}

export type Mode = 'study' | 'driving'

/** Audio engine surface shared by Study Mode and Driving Mode. */
export interface PlayerApi {
  playing: boolean
  /** Read the audio clock directly (not throttled like `currentTime`) for smooth word highlighting. */
  now: () => number
  currentTime: number
  duration: number
  rate: number
  play: () => void
  toggle: () => void
  seek: (seconds: number) => void
  skip: (delta: number) => void
  cycleRate: () => void
}