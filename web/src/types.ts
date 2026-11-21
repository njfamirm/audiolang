export interface ExplanationFa {
  /** Natural Persian translation. */
  meaning: string
  /** Brief grammar note in Persian (1-2 sentences). */
  grammar: string
  /** Key idioms / phrases with Persian meaning. */
  idioms: string[]
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
  currentTime: number
  duration: number
  rate: number
  play: () => void
  toggle: () => void
  seek: (seconds: number) => void
  skip: (delta: number) => void
  cycleRate: () => void
}