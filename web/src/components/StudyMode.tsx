import { useState } from 'react'
import type { ExplanationFa, Lesson, Mode, PlayerApi, Segment } from '../types'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
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
}: Props) {
  const [openIds, setOpenIds] = useState<string[]>([])
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [bookmarkFlash, setBookmarkFlash] = useState(false)

  const toggleSegment = (segment: Segment) => {
    const isOpen = openIds.includes(segment.id)
    setOpenIds((previous) =>
      isOpen ? previous.filter((id) => id !== segment.id) : [...previous, segment.id],
    )

    if (isOpen || segment.explanationFa || loading[segment.id]) return

    // Audio-only mode: never call OpenRouter until a key is configured.
    if (!aiConfigured) {
      setErrors((previous) => ({
        ...previous,
        [segment.id]:
          'توضیح فارسی غیرفعال است. برای فعال‌سازی، OPENROUTER_API_KEY را در فایل .dev.vars قرار دهید و برنامه را دوباره اجرا کنید.',
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

  const submitWord = async (segment: Segment, segmentExplanation: ExplanationFa) => {
    const word = (drafts[segment.id] ?? '').trim()
    if (!word) return
    await onSaveWord({
      word,
      contextSentence: segment.text,
      meaningFa: segmentExplanation.meaning,
    })
    setSavedIds((previous) => [...previous, segment.id])
    setDrafts((previous) => ({ ...previous, [segment.id]: '' }))
    setTimeout(() => setSavedIds((previous) => previous.filter((id) => id !== segment.id)), 1800)
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
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
          Transcript ({lesson.segments.length})
        </h3>

        {!lesson.transcribed && (
          <div className="mt-3 flex flex-col gap-3 rounded-sm border border-line bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink">Full transcript with timestamps</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">
                {transcriptionConfigured
                  ? 'Transcribes the MP3 through OpenRouter (one call per lesson, then cached).'
                  : 'Add OPENROUTER_API_KEY to .dev.vars (or as a Worker secret) to enable transcription.'}
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

        <ul className="mt-3 flex flex-col gap-2">
          {lesson.segments.map((segment) => {
            const isOpen = openIds.includes(segment.id)
            const isActive = activeSegmentId === segment.id
            const explanation = segment.explanationFa
            const error = errors[segment.id]
            const isLoading = loading[segment.id]
            const hasTimestamp = typeof segment.startSec === 'number'

            return (
              <li
                key={segment.id}
                className={`overflow-hidden rounded-sm border border-line bg-card ${
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
                  <button
                    type="button"
                    onClick={() => toggleSegment(segment)}
                    className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
                  >
                    <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-neutral-600">
                      {segment.index + 1}
                    </span>
                    <span className="flex-1 text-[15px] leading-7 text-ink" dir="ltr">
                      {segment.text}
                    </span>
                    <span className="mt-1 shrink-0 text-xs text-neutral-600">
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-line px-4 py-4" dir="rtl">
                    {isLoading && (
                      <p className="fa text-sm text-muted">در حال آماده‌سازی توضیح فارسی…</p>
                    )}

                    {!isLoading && error && (
                      <p className={`fa text-sm ${aiConfigured ? 'text-red-400/80' : 'text-muted'}`}>
                        {error}
                      </p>
                    )}

                    {!isLoading && !error && explanation && (
                      <div className="fa flex flex-col gap-3">
                        <div>
                          <p className="mb-1 text-[11px] font-medium text-neutral-500">معنی</p>
                          <p className="text-[15px] text-ink">{explanation.meaning}</p>
                        </div>

                        {explanation.grammar && explanation.grammar !== '—' && (
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-neutral-500">گرامر</p>
                            <p className="text-[14px] text-neutral-300">{explanation.grammar}</p>
                          </div>
                        )}

                        {explanation.idioms.length > 0 && (
                          <div>
                            <p className="mb-1 text-[11px] font-medium text-neutral-500">
                              اصطلاح‌ها و لغات کلیدی
                            </p>
                            <ul className="flex flex-col gap-1">
                              {explanation.idioms.map((idiom) => (
                                <li key={idiom} className="text-[14px] text-neutral-300">
                                  • {idiom}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="mt-1 flex items-center gap-2 border-t border-line pt-3">
                          <input
                            type="text"
                            dir="ltr"
                            value={drafts[segment.id] ?? ''}
                            onChange={(event) =>
                              setDrafts((previous) => ({
                                ...previous,
                                [segment.id]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void submitWord(segment, explanation)
                            }}
                            placeholder="word or phrase"
                            className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void submitWord(segment, explanation)}
                            className="shrink-0 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-ink transition-colors hover:border-neutral-500"
                          >
                            {savedIds.includes(segment.id) ? '✓ Saved' : 'Save Word'}
                          </button>
                        </div>
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