import { useMemo } from 'react'
import type { ActivityLog, Lesson, VocabItem } from '../types'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Local `YYYY-MM-DD` key, matching the server's activity log keys. */
function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** A day counts toward the streak/heatmap when it has ≥5 min listening or ≥3 reviews. */
function isActiveDay(entry?: { listenSec: number; reviews: number }): boolean {
  return Boolean(entry && (entry.listenSec >= 300 || entry.reviews >= 3))
}

function hasActivity(entry?: { listenSec: number; reviews: number }): boolean {
  return Boolean(entry && (entry.listenSec > 0 || entry.reviews > 0))
}

function listened(lesson: Lesson): boolean {
  return (
    typeof lesson.durationSec === 'number' &&
    lesson.durationSec > 0 &&
    lesson.lastPositionSec >= lesson.durationSec * 0.8
  )
}

function isMastered(lesson: Lesson): boolean {
  return listened(lesson) && Boolean(lesson.quizCompleted) && Boolean(lesson.outputCompleted)
}

function cefr(lesson: Lesson): string | undefined {
  return lesson.cefrLevel || lesson.sourceLevel
}

/** B1–B2 band, used to prioritize the next lesson. */
function isIntermediate(lesson: Lesson): boolean {
  const level = cefr(lesson) ?? ''
  return level.includes('B1') || level.includes('B2')
}

function pickUpNext(lessons: Lesson[]): Lesson | null {
  const started = lessons.find((lesson) => lesson.lastPositionSec > 5 && !isMastered(lesson))
  if (started) return started
  const intermediate = lessons.find((lesson) => isIntermediate(lesson) && !isMastered(lesson))
  if (intermediate) return intermediate
  return lessons.find((lesson) => !isMastered(lesson)) ?? null
}

interface Props {
  lessons: Lesson[]
  vocab: VocabItem[]
  activityLog: ActivityLog
  syncing: boolean
  aiConfigured: boolean
  transcriptionConfigured: boolean
  authRequired: boolean
  onOpen: (id: string) => void
  onOpenVocab: () => void
  onLock: () => void
  onSync: () => void
  onAdd: () => void
}

export default function LessonList({
  lessons,
  vocab,
  activityLog,
  syncing,
  aiConfigured,
  transcriptionConfigured,
  authRequired,
  onOpen,
  onOpenVocab,
  onLock,
  onSync,
  onAdd,
}: Props) {
  const now = Date.now()

  const { days, streak } = useMemo(() => {
    const today = new Date()
    const cells: { key: string; active: boolean; light: boolean }[] = []
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date(today)
      date.setDate(today.getDate() - offset)
      const key = dayKey(date)
      const entry = activityLog[key]
      cells.push({ key, active: isActiveDay(entry), light: !isActiveDay(entry) && hasActivity(entry) })
    }

    let count = 0
    const cursor = new Date(today)
    // A streak stays alive until today ends: if today is quiet, count back from yesterday.
    if (!isActiveDay(activityLog[dayKey(cursor)])) cursor.setDate(cursor.getDate() - 1)
    while (isActiveDay(activityLog[dayKey(cursor)])) {
      count += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return { days: cells, streak: count }
  }, [activityLog])

  const dueCount = useMemo(
    () =>
      vocab.filter((item) => !item.nextReviewAt || new Date(item.nextReviewAt).getTime() <= now)
        .length,
    [vocab, now],
  )

  const upNext = useMemo(() => pickUpNext(lessons), [lessons])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">AudioLang</h1>
            <p className="mt-1 text-sm text-muted">
              Listen while you drive, study when you park. Free podcast feeds — no TTS, no cloud.
            </p>
          </div>
          {authRequired && (
            <button
              type="button"
              onClick={onLock}
              className="shrink-0 rounded-sm border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
            >
              Lock
            </button>
          )}
        </div>
      </header>

      {/* 30-day activity heatmap + streak */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-line bg-card p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-lg font-semibold tabular-nums text-ink">
            {streak}d streak
          </span>
          <span className="text-xs text-muted">Last 30 days</span>
        </div>
        <div className="grid w-full min-w-0 grid-cols-15 gap-1 sm:w-auto sm:grid-cols-30">
          {days.map((day) => (
            <span
              key={day.key}
              title={day.key}
              className={`h-3 w-3 rounded-[3px] sm:h-3.5 sm:w-3.5 ${
                day.active
                  ? 'bg-emerald-500'
                  : day.light
                    ? 'bg-emerald-500/25'
                    : 'bg-[#1c1c1c]'
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenVocab}
          className={`w-full shrink-0 rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors sm:ml-auto sm:w-auto ${
            dueCount > 0
              ? 'border-emerald-500 text-emerald-400 hover:bg-emerald-500/10'
              : 'border-line text-muted hover:border-neutral-500 hover:text-ink'
          }`}
        >
          Review Vocab ({dueCount} due)
        </button>
      </div>

      {/* Today's Lesson hero card */}
      {upNext && (
        <div className="mb-5 rounded-md border border-line bg-card p-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-400">
            Today&apos;s Lesson
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-lg font-medium text-ink" dir="ltr">
              {upNext.title}
            </h2>
            {cefr(upNext) && (
              <span className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted">
                {cefr(upNext)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {upNext.source} · {upNext.segments.length} sentences
          </p>
          <button
            type="button"
            onClick={() => onOpen(upNext.id)}
            className="mt-4 w-full rounded-sm border border-emerald-500 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-opacity hover:opacity-90 sm:w-auto"
          >
            {upNext.lastPositionSec > 5 ? 'Continue' : 'Start Lesson'}
          </button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          className="rounded-sm border border-line bg-card px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Sync Podcasts'}
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-sm border border-line bg-card px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-neutral-500"
        >
          + Custom Lesson
        </button>
        <button
          type="button"
          onClick={onOpenVocab}
          className="ml-auto rounded-sm border border-line px-3 py-2 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
        >
          Vocabulary ({vocab.length})
        </button>
      </div>

      {(!aiConfigured || !transcriptionConfigured) && (
        <div className="mb-5 flex flex-col gap-1 rounded-sm border border-line bg-card p-3 text-xs text-muted">
          {!transcriptionConfigured && (
            <p>
              Full transcripts are off. Add the{' '}
              <span className="text-ink">[ai]</span> binding in{' '}
              <span className="text-ink">wrangler.toml</span> to unlock timestamped, synced
              transcripts.
            </p>
          )}
          {!aiConfigured && (
            <p>
              Persian explanations are off. Add the{' '}
              <span className="text-ink">[ai]</span> binding in{' '}
              <span className="text-ink">wrangler.toml</span> and redeploy.
            </p>
          )}
        </div>
      )}

      {lessons.length === 0 ? (
        <div className="rounded-sm border border-dashed border-line p-8 text-center">
          <p className="text-sm text-muted">
            No lessons yet. Tap <span className="text-ink">Sync Podcasts</span> to pull the latest
            free episodes.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
          {lessons.map((lesson) => {
            const steps = [listened(lesson), Boolean(lesson.quizCompleted), Boolean(lesson.outputCompleted)]
            const mastered = isMastered(lesson)
            const level = cefr(lesson)
            const prepared = Boolean(lesson.aiPack) && (lesson.transcriptVersion ?? 1) >= 3
            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() => onOpen(lesson.id)}
                  className="block w-full px-4 py-4 text-left transition-colors hover:bg-neutral-900"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="min-w-0 flex-1 truncate text-base font-medium text-ink" dir="ltr">
                      {lesson.title}
                    </h3>
                    <span className="shrink-0 whitespace-nowrap text-xs text-neutral-500">
                      {formatDate(lesson.publishedAt)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    {level && (
                      <span className="rounded-sm border border-line px-2 py-0.5">{level}</span>
                    )}
                    <span className="rounded-sm border border-line px-2 py-0.5">{lesson.source}</span>
                    {prepared && (
                      <span className="rounded-sm border border-emerald-500/40 px-2 py-0.5 text-emerald-400">
                        Prepared
                      </span>
                    )}
                    <span>{lesson.segments.length} sentences</span>
                    {lesson.bookmarks.length > 0 && (
                      <span className="text-ink">★ {lesson.bookmarks.length} bookmark(s)</span>
                    )}
                    {lesson.lastPositionSec > 3 && (
                      <span>Resume at {formatTime(lesson.lastPositionSec)}</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    {mastered ? (
                      <span className="rounded-sm bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-[#0a0a0a]">
                        Mastered
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5" title="Listened · Quiz · Output">
                        {steps.map((done, index) => (
                          <span
                            key={index}
                            className={`h-1.5 w-1.5 rounded-full ${
                              done ? 'bg-emerald-500' : 'bg-neutral-700'
                            }`}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
