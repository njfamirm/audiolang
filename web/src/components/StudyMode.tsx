import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExplanationFa, Lesson, Mode, OutputFeedback, PlayerApi, Segment } from '../types'

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
  preparing: boolean
  onExit: () => void
  onModeChange: (mode: Mode) => void
  onAddBookmark: () => Promise<number | null>
  onPrepare: () => void
  onCompleteQuiz: () => void
  onReviewOutput: (userText: string) => Promise<OutputFeedback | null>
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
  preparing,
  onExit,
  onModeChange,
  onAddBookmark,
  onPrepare,
  onCompleteQuiz,
  onReviewOutput,
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
  const [savedWarmup, setSavedWarmup] = useState<string[]>([])
  const [bookmarkFlash, setBookmarkFlash] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeWord, setActiveWord] = useState<{ segmentId: string; index: number } | null>(null)

  const [blindMode, setBlindMode] = useState(false)
  const [revealedIds, setRevealedIds] = useState<string[]>([])
  const [loopingId, setLoopingId] = useState<string | null>(null)
  const [warmupOpen, setWarmupOpen] = useState(true)

  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({})
  const [outputText, setOutputText] = useState('')
  const [outputBusy, setOutputBusy] = useState(false)
  const [outputFeedback, setOutputFeedback] = useState<OutputFeedback | null>(
    lesson.lastOutputFeedback ?? null,
  )

  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({})
  const userScrollingRef = useRef(false)
  const scrollResetRef = useRef<number | null>(null)
  const quizSentRef = useRef(false)
  const playerRef = useRef(player)
  playerRef.current = player

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

  // Sentence loop: while active, pause ~800ms past the sentence end (for shadowing), then
  // rewind and resume. Driven off the live audio clock, held in refs so React re-renders
  // never reset the pause timer.
  useEffect(() => {
    if (!loopingId) return
    const segment = lesson.segments.find((item) => item.id === loopingId)
    if (!segment || typeof segment.startSec !== 'number' || typeof segment.endSec !== 'number') {
      return
    }
    const start = segment.startSec
    const end = segment.endSec
    let frame = 0
    let holding = false
    let timer: number | null = null
    const tick = () => {
      if (!holding && playerRef.current.now() >= end) {
        holding = true
        playerRef.current.pause()
        timer = window.setTimeout(() => {
          playerRef.current.seek(start)
          playerRef.current.play()
          holding = false
        }, 800)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [loopingId, lesson.segments])

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

  const saveWarmup = async (key: string, phrase: string, meaningFa: string) => {
    try {
      await onSaveWord({ word: phrase, contextSentence: '', meaningFa })
      setSavedWarmup((previous) => [...previous, key])
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

  const toggleLoop = (segment: Segment) => {
    setLoopingId((previous) => (previous === segment.id ? null : segment.id))
  }

  const answerQuiz = (questionIndex: number, optionIndex: number) => {
    setQuizAnswers((previous) => ({ ...previous, [questionIndex]: optionIndex }))
  }

  const quiz = lesson.aiPack?.quiz ?? []
  const quizDone = quiz.length > 0 && Object.keys(quizAnswers).length === quiz.length
  useEffect(() => {
    if (quizDone && !quizSentRef.current) {
      quizSentRef.current = true
      onCompleteQuiz()
    }
  }, [quizDone, onCompleteQuiz])

  const submitOutput = async () => {
    const text = outputText.trim()
    if (!text || outputBusy) return
    setOutputBusy(true)
    try {
      const feedback = await onReviewOutput(text)
      if (feedback) setOutputFeedback(feedback)
    } catch {
      // Toast handled upstream.
    } finally {
      setOutputBusy(false)
    }
  }

  const needsPrepare =
    !lesson.aiPack ||
    !lesson.transcribed ||
    !lesson.audioCached ||
    (lesson.transcriptVersion ?? 1) < 3
  const isUpgrade = Boolean(lesson.transcribed) && (lesson.transcriptVersion ?? 1) < 3
  const prepareLabel = isUpgrade ? 'Upgrade Sync & AI Pack' : 'Prepare Full Lesson'

  const loopingSegment = useMemo(
    () => lesson.segments.find((segment) => segment.id === loopingId) ?? null,
    [lesson.segments, loopingId],
  )

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

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
            onClick={() => setBlindMode((value) => !value)}
            className={`rounded-sm border px-3 py-2 text-xs transition-colors ${
              blindMode
                ? 'border-emerald-500 text-emerald-400'
                : 'border-line bg-card text-ink hover:border-neutral-500'
            }`}
          >
            Blind Mode
          </button>
          {loopingSegment && (
            <button
              type="button"
              onClick={() => setLoopingId(null)}
              className="rounded-sm border border-emerald-500 px-3 py-2 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/10"
            >
              Looping #{loopingSegment.index + 1} ✕
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleBookmark()}
            className="ml-auto rounded-sm border border-line bg-card px-3 py-2 text-xs text-ink transition-colors hover:border-neutral-500"
          >
            {bookmarkFlash ? '✓ Saved' : '★ Bookmark'}
          </button>
        </div>
      </div>

      {needsPrepare && (
        <div className="mt-5 flex flex-col gap-3 rounded-md border border-emerald-500/40 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">
              {isUpgrade ? 'Upgrade to synced audio & AI pack' : 'Prepare this lesson'}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {preparing
                ? 'Preparing audio, sentences & AI pack…'
                : transcriptionConfiguredText(aiConfigured)}
            </p>
          </div>
          <button
            type="button"
            onClick={onPrepare}
            disabled={preparing || !aiConfigured}
            className="shrink-0 rounded-sm border border-emerald-500 bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:border-line disabled:bg-panel disabled:text-muted"
          >
            {preparing ? 'Preparing…' : prepareLabel}
          </button>
        </div>
      )}

      {lesson.bookmarks.length > 0 && (
        <section className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
            Bookmarks ({lesson.bookmarks.length})
          </h3>
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
        </section>
      )}

      {lesson.aiPack?.warmup && lesson.aiPack.warmup.length > 0 && (
        <section className="mt-6 rounded-md border border-line bg-card">
          <button
            type="button"
            onClick={() => setWarmupOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-ink">
              Pre-Listening Warmup ({lesson.aiPack.warmup.length} Key Phrases)
            </span>
            <span className="text-xs text-muted">{warmupOpen ? '▲' : '▼'}</span>
          </button>
          {warmupOpen && (
            <ul className="flex flex-col gap-2 border-t border-line px-4 py-3">
              {lesson.aiPack.warmup.map((item, index) => {
                const key = `warmup#${index}`
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-sm border border-line bg-panel px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] text-ink" dir="ltr">
                        {item.phrase}
                      </span>
                      {item.meaningFa && (
                        <span className="fa mt-0.5 block text-[13px] text-neutral-400">
                          {item.meaningFa}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => void saveWarmup(key, item.phrase, item.meaningFa)}
                      disabled={savedWarmup.includes(key)}
                      className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-muted transition-colors hover:border-neutral-500 hover:text-ink disabled:opacity-50"
                      dir="ltr"
                    >
                      {savedWarmup.includes(key) ? '✓ Saved' : '+ Save'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

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

        <ul
          className="mt-3 flex flex-col gap-3"
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
            const blinded = blindMode && !revealedIds.includes(segment.id)
            const isLooping = loopingId === segment.id
            let wordOrdinal = -1

            return (
              <li
                key={segment.id}
                ref={(element) => {
                  itemRefs.current[segment.id] = element
                }}
                className={`scroll-mt-28 scroll-mb-24 overflow-hidden rounded-md border border-line bg-card ${
                  isActive ? 'border-l-2 border-l-emerald-500' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
                  <span className="text-xs tabular-nums text-neutral-600">{segment.index + 1}</span>
                  {hasTimestamp && (
                    <span className="text-xs tabular-nums text-muted">
                      {formatTime(segment.startSec as number)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    {hasTimestamp && (
                      <button
                        type="button"
                        onClick={() => playFrom(segment)}
                        title="Play from here"
                        className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-neutral-500 hover:text-ink"
                      >
                        ▶
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleLoop(segment)}
                      disabled={!hasTimestamp}
                      title="Loop sentence"
                      className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        isLooping
                          ? 'border-emerald-500 text-emerald-400'
                          : 'border-line text-muted hover:border-neutral-500 hover:text-ink'
                      }`}
                    >
                      ↻ Loop
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSegment(segment)}
                      className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-neutral-500 hover:text-ink"
                    >
                      {isOpen ? 'Hide' : 'Explain'}
                    </button>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <div
                    className={`text-[15.5px] leading-8 text-ink ${blinded ? 'blur-[5px] select-none' : ''}`}
                    dir="ltr"
                    onClick={blinded ? () => setRevealedIds((prev) => [...prev, segment.id]) : undefined}
                  >
                    {segment.text.split(/(\s+)/).map((token, index) => {
                      if (!token.trim()) return <span key={index}>{token}</span>
                      const word = cleanWord(token)
                      if (!word) return <span key={index}>{token}</span>
                      wordOrdinal += 1
                      if (blinded) return <span key={index}>{token}</span>
                      const highlighted = wordOrdinal === activeIndex
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => selectWord(segment, token)}
                          className={`inline-block rounded-sm px-1.5 py-0.5 transition-colors ${
                            highlighted
                              ? 'bg-emerald-500 text-[#0a0a0a]'
                              : 'hover:bg-neutral-800 hover:text-white'
                          }`}
                        >
                          {token}
                        </button>
                      )
                    })}
                  </div>
                  {blinded && (
                    <p className="mt-2 text-[11px] text-neutral-600">Tap to reveal</p>
                  )}
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
                        {explanation.simpleEnglish && (
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-emerald-400">
                              Simpler English
                            </p>
                            <p className="text-[15px] text-ink" dir="ltr">
                              {explanation.simpleEnglish}
                            </p>
                          </div>
                        )}

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

      {quiz.length > 0 && (
        <section className="mt-8">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
            Comprehension Quiz
          </h3>
          <div className="mt-3 flex flex-col gap-3">
            {quiz.map((item, questionIndex) => {
              const selected = quizAnswers[questionIndex]
              const answered = selected !== undefined
              return (
                <div key={questionIndex} className="rounded-md border border-line bg-card p-4">
                  <p className="text-sm font-medium text-ink" dir="ltr">
                    {questionIndex + 1}. {item.question}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {item.options.map((option, optionIndex) => {
                      const isCorrect = optionIndex === item.correctIndex
                      const isSelected = selected === optionIndex
                      let tone = 'border-line text-ink hover:border-neutral-500'
                      if (answered) {
                        if (isCorrect) tone = 'border-emerald-500 text-emerald-400'
                        else if (isSelected) tone = 'border-red-500/60 text-red-400'
                        else tone = 'border-line text-muted'
                      }
                      return (
                        <button
                          key={optionIndex}
                          type="button"
                          onClick={() => !answered && answerQuiz(questionIndex, optionIndex)}
                          disabled={answered}
                          dir="ltr"
                          className={`rounded-sm border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${tone}`}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                  {answered && item.explanationFa && (
                    <p className="fa mt-3 text-[14px] text-neutral-300">{item.explanationFa}</p>
                  )}
                </div>
              )
            })}
            {quizDone && (
              <p className="text-xs text-emerald-400">Quiz complete ✓</p>
            )}
          </div>
        </section>
      )}

      {lesson.aiPack?.outputPrompt && (
        <section className="mt-8">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
            Output Practice
          </h3>
          <div className="mt-3 rounded-md border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink" dir="ltr">
              {lesson.aiPack.outputPrompt}
            </p>
            <textarea
              value={outputText}
              onChange={(event) => setOutputText(event.target.value)}
              rows={4}
              dir="ltr"
              placeholder="Type or speak your answer…"
              className="mt-3 w-full rounded-sm border border-line bg-panel px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-500"
            />
            <button
              type="button"
              onClick={() => void submitOutput()}
              disabled={outputBusy || !outputText.trim()}
              className="mt-3 rounded-sm border border-ink bg-ink px-4 py-2 text-sm font-medium text-bg transition-opacity disabled:cursor-not-allowed disabled:border-line disabled:bg-panel disabled:text-muted"
            >
              {outputBusy ? 'Reviewing…' : 'Get AI Feedback'}
            </button>

            {outputFeedback && (
              <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-emerald-400">Native Version</p>
                  <p className="text-[15px] text-ink" dir="ltr">
                    {outputFeedback.nativeVersion}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium text-neutral-500">Feedback</p>
                  <p className="fa text-[14px] text-neutral-300">{outputFeedback.feedbackFa}</p>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

/** Copy shown under the prepare banner when the AI binding is missing. */
function transcriptionConfiguredText(aiConfigured: boolean): string {
  return aiConfigured
    ? 'Generates the full synced transcript and caches the audio, warmup and quiz once.'
    : 'Add the [ai] binding in wrangler.toml to enable preparation.'
}
