import { useEffect, useRef, useState } from 'react'
import type { ExplanationFa, Lesson, Mode, PlayerApi, Segment } from '../types'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** Split an idiom string like `"phrase: meaning"` into its English part and Persian meaning. */
function splitIdiom(idiom: string): { phrase: string; meaning: string } {
  const separator = idiom.search(/[:：]/)
  if (separator === -1) return { phrase: idiom.trim(), meaning: '' }
  return {
    phrase: idiom.slice(0, separator).trim(),
    meaning: idiom.slice(separator + 1).trim(),
  }
}

/** Strip surrounding punctuation from a tapped token, keeping inner apostrophes/hyphens. */
function cleanWord(token: string): string {
  return token.replace(/^[^A-Za-z']+/, '').replace(/[^A-Za-z']+$/, '')
}

interface Props {
  lesson: Lesson
  player: PlayerApi
  activeSegmentId: string | null
  aiConfigured: boolean
  transcriptionConfigured: boolean
  transcribing: boolean
  onExit: () => void
  onModeChange: (mode: Mode) => void
  onAddBookmark: () => Promise<number | null>
  onTranscribe: () => void
  onAlign: () => void
  onExplain: (segmentId: string) => Promise<ExplanationFa>
  onSaveWord: (payload: {
    word: string
    contextSentence: string
    meaningFa: string
  }) => Promise<void>
  onDefineWord: (word: string, contextSentence: string) => Promise<void>
}

export default function StudyMode({
  lesson,
  player,
  activeSegmentId,
  aiConfigured,
  transcriptionConfigured,
  transcribing,
  onExit,
  onModeChange,
  onAddBookmark,
  onTranscribe,
  onAlign,
  onExplain,
  onSaveWord,
  onDefineWord,
}: Props) {
  const [openIds, setOpenIds] = useState<string[]>([])
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [quickWords, setQuickWords] = useState<Record<string, string>>({})
  const [defining, setDefining] = useState<Record<string, boolean>>({})
  const [savedSegments, setSavedSegments] = useState<string[]>([])
  const [savedIdioms, setSavedIdioms] = useState<string[]>([])
  const [bookmarkFlash, setBookmarkFlash] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeWord, setActiveWord] = useState<{ segmentId: string; index: number } | null>(null)

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const userScrollingRef = useRef(false)
  const scrollResetRef = useRef<number | null>(null)

  const markUserScroll = () => {
    userScrollingRef.current = true
    if (scrollResetRef.current !== null) window.clearTimeout(scrollResetRef.current)
    scrollResetRef.current = window.setTimeout(() => {
      userScrollingRef.current = false
    }, 4000)
  }

  useEffect(
    () => () => {
      if (scrollResetRef.current !== null) window.clearTimeout(scrollResetRef.current)
    },
    [],
  )

  // Subtle auto-scroll to the sentence being played — paused while the user is scrolling.
  useEffect(() => {
    if (!autoScroll || !player.playing || !activeSegmentId || userScrollingRef.current) return
    itemRefs.current[activeSegmentId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeSegmentId, autoScroll, player.playing])

  // Word-by-word highlight, driven by the live audio clock so it stays smooth between the
  // browser's throttled `timeupdate` events. State only updates when the word actually changes.
  const now = player.now
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const time = now()
      let next: { segmentId: string; index: number } | null = null
      for (const segment of lesson.segments) {
        const words = segment.words
        if (!words || words.length === 0) continue
        if (time < words[0].start || time >= words[words.length - 1].end) continue
        let index = words.findIndex((word) => time >= word.start && time < word.end)
        if (index === -1) {
          // Between words (a short pause): keep the word we just finished highlighted.
          for (let i = 0; i < words.length; i += 1) {
            if (time >= words[i].end) index = i
            else break
          }
        }
        if (index >= 0) next = { segmentId: segment.id, index }
        break
      }
      setActiveWord((previous) =>
        previous && next && previous.segmentId === next.segmentId && previous.index === next.index
          ? previous
          : next,
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [lesson.segments, now])

  const loadExplanation = (segment: Segment) => {
    if (segment.explanationFa || loading[segment.id]) return

    // Audio-only mode: never call OpenRouter until a key is configured.
    if (!aiConfigured) {
      setErrors((previous) => ({
        ...previous,
        [segment.id]:
          'Persian explanations are off. Add the [ai] binding in wrangler.toml and redeploy.',
      }))
      return
    }

    setLoading((previous) => ({ ...previous, [segment.id]: true }))
    setErrors((previous) => ({ ...previous, [segment.id]: '' }))
    onExplain(segment.id)
      .catch((error: unknown) => {
        setErrors((previous) => ({
          ...previous,
          [segment.id]: error instanceof Error ? error.message : 'Explanation failed',
        }))
      })
      .finally(() => {
        setLoading((previous) => ({ ...previous, [segment.id]: false }))
      })
  }

  const openSegment = (segment: Segment) => {
    setOpenIds((previous) =>
      previous.includes(segment.id) ? previous : [...previous, segment.id],
    )
    loadExplanation(segment)
  }

  const toggleSegment = (segment: Segment) => {
    const isOpen = openIds.includes(segment.id)
    setOpenIds((previous) =>
      isOpen ? previous.filter((id) => id !== segment.id) : [...previous, segment.id],
    )
    if (!isOpen) loadExplanation(segment)
  }

  const selectWord = (segment: Segment, token: string) => {
    const word = cleanWord(token)
    if (!word) return
    setQuickWords((previous) => ({ ...previous, [segment.id]: word }))
    openSegment(segment)
  }

  const defineAndSave = async (segment: Segment) => {
    const word = quickWords[segment.id]
    if (!word || defining[segment.id]) return
    setDefining((previous) => ({ ...previous, [segment.id]: true }))
    try {
      await onDefineWord(word, segment.text)
      setQuickWords((previous) => {
        const next = { ...previous }
        delete next[segment.id]
        return next
      })
      setSavedSegments((previous) => [...previous, segment.id])
      setTimeout(
        () => setSavedSegments((previous) => previous.filter((id) => id !== segment.id)),
        1800,
      )
    } catch {
      // App surfaces the error via toast; keep the word so the user can retry.
    } finally {
      setDefining((previous) => ({ ...previous, [segment.id]: false }))
    }
  }

  const saveIdiom = async (segment: Segment, key: string, idiom: string) => {
    const { phrase, meaning } = splitIdiom(idiom)
    if (!phrase) return
    try {
      await onSaveWord({ word: phrase, contextSentence: segment.text, meaningFa: meaning })
      setSavedIdioms((previous) => [...previous, key])
      setTimeout(() => setSavedIdioms((previous) => previous.filter((item) => item !== key)), 2200)
    } catch {
      // Toast handled upstream.
    }
  }

  const handleBookmark = async () => {
    const mark = await onAddBookmark()
    if (mark === null) return
    setBookmarkFlash(true)
    setTimeout(() => setBookmarkFlash(false), 1500)
  }

  const playFrom = (segment: Segment) => {
    if (typeof segment.startSec !== 'number') return
    player.seek(segment.startSec)
    player.play()
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-32">
      <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-bg/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onExit}
            className="shrink-0 rounded-sm border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
          >
            ← Library
          </button>
          <div className="flex shrink-0 overflow-hidden rounded-sm border border-line">
            <span className="bg-ink px-3 py-1.5 text-xs font-medium text-bg">Study Mode</span>
            <button
              type="button"
              onClick={() => onModeChange('driving')}
              className="px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              Driving Mode
            </button>
          </div>
        </div>

        <h2 className="mt-3 truncate text-base font-medium text-ink" dir="ltr">
          {lesson.title}
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          {lesson.source}
          {lesson.transcribed && (
            <span className="ml-2 text-neutral-500">
              · {lesson.timingApprox ? '≈ estimated timestamps' : 'timestamps'}
            </span>
          )}
        </p>

        <div className="mt-3 flex items-center gap-3" dir="ltr">
          <span className="tabular-nums text-xs text-muted">{formatTime(player.currentTime)}</span>
          <input
            type="range"
            min={0}
            max={player.duration || 0}
            step={1}
            value={player.currentTime}
            onChange={(event) => player.seek(Number(event.target.value))}
            className="h-1 flex-1"
            aria-label="Seek"
          />
          <span className="tabular-nums text-xs text-muted">{formatTime(player.duration)}</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => player.skip(-5)}
            className="rounded-sm border border-line bg-card px-3 py-2 text-xs text-ink transition-colors hover:border-neutral-500"
          >
            −5s
          </button>
          <button
            type="button"
            onClick={player.toggle}
            className="min-w-[92px] rounded-sm border border-ink bg-ink px-5 py-2 text-sm font-semibold text-bg"
          >
            {player.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            type="button"
            onClick={() => player.skip(5)}
            className="rounded-sm border border-line bg-card px-3 py-2 text-xs text-ink transition-colors hover:border-neutral-500"
          >
            +5s
          </button>
          <button
            type="button"
            onClick={player.cycleRate}
            className="rounded-sm border border-line bg-card px-3 py-2 text-xs text-ink transition-colors hover:border-neutral-500"
          >
            {player.rate.toFixed(2)}x
          </button>
          <button
            type="button"
            onClick={() => void handleBookmark()}
            className="ml-auto rounded-sm border border-line bg-card px-3 py-2 text-xs text-ink transition-colors hover:border-neutral-500"
          >
            {bookmarkFlash ? '✓ Saved' : '★ Bookmark'}
          </button>
        </div>
      </div>

      <section className="mt-5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
          Bookmarks ({lesson.bookmarks.length})
        </h3>
        {lesson.bookmarks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No bookmarks yet. Tap Bookmark while driving to mark a moment.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {lesson.bookmarks.map((mark) => (
              <button
                key={mark}
                type="button"
                onClick={() => player.seek(mark)}
                className="tabular-nums rounded-sm border border-line bg-card px-3 py-1.5 text-xs text-ink transition-colors hover:border-neutral-500"
              >
                ▶ {formatTime(mark)}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mt-7">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
            Transcript ({lesson.segments.length})
          </h3>
          <button
            type="button"
            onClick={() => setAutoScroll((value) => !value)}
            className={`rounded-sm border px-2 py-1 text-[11px] transition-colors ${
              autoScroll
                ? 'border-neutral-500 text-ink'
                : 'border-line text-muted hover:border-neutral-500 hover:text-ink'
            }`}
          >
            Auto-scroll: {autoScroll ? 'On' : 'Off'}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Tap a word to save it · tap the sentence to see the AI explanation.
        </p>

        {lesson.transcribed && !lesson.audioCached && (
          <div className="mt-3 flex flex-col gap-3 rounded-sm border border-line bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink">Audio not frozen yet</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">
                This transcript was synced before audio freezing. Re-sync once to lock the exact
                MP3 bytes, so playback and timestamps can no longer drift.
              </p>
            </div>
            <button
              type="button"
              onClick={onTranscribe}
              disabled={transcribing}
              className="shrink-0 rounded-sm border border-ink bg-ink px-4 py-2 text-sm font-medium text-bg transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-panel disabled:text-muted"
            >
              {transcribing ? 'Re-syncing…' : 'Re-sync & Freeze Audio'}
            </button>
          </div>
        )}

        {!lesson.transcribed && (
          <div className="mt-3 flex flex-col gap-3 rounded-sm border border-line bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink">Full transcript with timestamps</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">
                {transcriptionConfigured
                  ? 'Transcribes the MP3 through Workers AI (one call per lesson, then cached).'
                  : 'Add the [ai] binding to wrangler.toml to enable transcription.'}
              </p>
              <button
                type="button"
                onClick={onAlign}
                disabled={transcribing}
                className="mt-1 text-xs text-muted underline decoration-neutral-700 underline-offset-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Or only estimate timings for the current transcript — free, no API call
              </button>
            </div>
            <button
              type="button"
              onClick={onTranscribe}
              disabled={!transcriptionConfigured || transcribing}
              className="shrink-0 rounded-sm border border-ink bg-ink px-4 py-2 text-sm font-medium text-bg transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-panel disabled:text-muted"
            >
              {transcribing ? 'Transcribing…' : 'Sync Full Transcript'}
            </button>
          </div>
        )}

        <ul
          className="mt-3 flex flex-col gap-2"
          onWheel={markUserScroll}
          onTouchStart={markUserScroll}
        >
          {lesson.segments.map((segment) => {
            const isOpen = openIds.includes(segment.id)
            const isActive = activeSegmentId === segment.id
            const explanation = segment.explanationFa
            const error = errors[segment.id]
            const isLoading = loading[segment.id]
            const hasTimestamp = typeof segment.startSec === 'number'
            const quickWord = quickWords[segment.id]
            const activeIndex = activeWord?.segmentId === segment.id ? activeWord.index : -1
            // Ordinal of the word currently being rendered, matching `segment.words` order.
            let wordOrdinal = -1

            return (
              <li
                key={segment.id}
                ref={(element) => {
                  itemRefs.current[segment.id] = element
                }}
                className={`scroll-mt-28 scroll-mb-24 overflow-hidden rounded-sm border border-line bg-card ${
                  isActive ? 'border-l-2 border-l-ink bg-neutral-900' : ''
                }`}
              >
                <div className="flex items-start">
                  {hasTimestamp && (
                    <button
                      type="button"
                      onClick={() => playFrom(segment)}
                      title={`Play from ${formatTime(segment.startSec as number)}`}
                      className="mt-2 ml-2 shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] tabular-nums text-muted transition-colors hover:border-neutral-500 hover:text-ink"
                    >
                      ▶ {formatTime(segment.startSec as number)}
                    </button>
                  )}
                  <div className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3">
                    <span className="mt-1 w-6 shrink-0 text-right text-xs tabular-nums text-neutral-600">
                      {segment.index + 1}
                    </span>
                    <span className="flex-1 text-[15px] leading-7 text-ink" dir="ltr">
                      {segment.text.split(/(\s+)/).map((token, index) => {
                        if (!token.trim()) return <span key={index}>{token}</span>
                        const word = cleanWord(token)
                        if (!word) return <span key={index}>{token}</span>
                        wordOrdinal += 1
                        const highlighted = wordOrdinal === activeIndex
                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() => selectWord(segment, token)}
                            className={`rounded-sm transition-colors ${
                              highlighted
                                ? 'bg-ink text-bg'
                                : 'hover:bg-neutral-800 hover:text-white'
                            }`}
                          >
                            {token}
                          </button>
                        )
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleSegment(segment)}
                      className="mt-0.5 shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-neutral-500 hover:text-ink"
                    >
                      {isOpen ? 'Hide' : 'AI'}
                    </button>
                  </div>
                </div>

                {quickWord && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-2.5" dir="ltr">
                    <span className="text-xs text-muted">Save word</span>
                    <span className="text-sm font-medium text-ink">{quickWord}</span>
                    <button
                      type="button"
                      onClick={() => void defineAndSave(segment)}
                      disabled={defining[segment.id]}
                      className="ml-auto shrink-0 rounded-sm border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savedSegments.includes(segment.id)
                        ? '✓ Saved'
                        : defining[segment.id]
                          ? 'Translating…'
                          : 'Translate & Save'}
                    </button>
                  </div>
                )}

                {isOpen && (
                  <div className="border-t border-line px-4 py-4">
                    {isLoading && <p className="text-sm text-muted">Loading explanation…</p>}

                    {!isLoading && error && (
                      <p className={`text-sm ${aiConfigured ? 'text-red-400/80' : 'text-muted'}`}>
                        {error}
                      </p>
                    )}

                    {!isLoading && !error && explanation && (
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="mb-1 text-[11px] font-medium text-neutral-500">Meaning</p>
                          <p className="fa text-[15px] text-ink">{explanation.meaning}</p>
                        </div>

                        {explanation.grammar && explanation.grammar !== '—' && (
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-neutral-500">Grammar</p>
                            <p className="fa text-[14px] text-neutral-300">{explanation.grammar}</p>
                          </div>
                        )}

                        {explanation.idioms.length > 0 && (
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-neutral-500">
                              Idioms &amp; Key Phrases
                            </p>
                            <ul className="flex flex-col gap-1.5">
                              {explanation.idioms.map((idiom, index) => {
                                const { phrase, meaning } = splitIdiom(idiom)
                                const key = `${segment.id}#${index}`
                                return (
                                  <li
                                    key={key}
                                    className="flex items-center justify-between gap-3 rounded-sm border border-line bg-panel px-3 py-1.5"
                                  >
                                    <span className="min-w-0 text-[14px] text-neutral-200" dir="ltr">
                                      {phrase}
                                      {meaning && (
                                        <span className="fa mr-2 inline-block text-neutral-400">
                                          — {meaning}
                                        </span>
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void saveIdiom(segment, key, idiom)}
                                      disabled={!phrase}
                                      className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-neutral-500 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                                      dir="ltr"
                                    >
                                      {savedIdioms.includes(key) ? '✓ Saved' : '+ Save'}
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
