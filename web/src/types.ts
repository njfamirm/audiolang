export interface ExplanationFa {
  /** Natural Persian translation. */
  meaning: string
  /** Brief grammar note in Persian (1-2 sentences). */
  grammar: string
  /** Key idioms / phrases with Persian meaning. */
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

/** Daily activity counters keyed by `YYYY-MM-DD`. */
export type ActivityLog = Record<string, ActivityLogEntry>

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
  pause: () => void
  toggle: () => void
  seek: (seconds: number) => void
  skip: (delta: number) => void
  cycleRate: () => void
}