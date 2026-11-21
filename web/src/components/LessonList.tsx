import type { Lesson } from '../types'

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

interface Props {
  lessons: Lesson[]
  vocabCount: number
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
  vocabCount,
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
          Vocabulary ({vocabCount})
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
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <button
                type="button"
                onClick={() => onOpen(lesson.id)}
                className="block w-full px-4 py-4 text-left transition-colors hover:bg-neutral-900"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-base font-medium text-ink" dir="ltr">
                    {lesson.title}
                  </h3>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {formatDate(lesson.publishedAt)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="rounded-sm border border-line px-2 py-0.5">{lesson.source}</span>
                  <span>{lesson.segments.length} sentences</span>
                  {lesson.bookmarks.length > 0 && (
                    <span className="text-ink">★ {lesson.bookmarks.length} bookmark(s)</span>
                  )}
                  {lesson.lastPositionSec > 3 && <span>Resume at {formatTime(lesson.lastPositionSec)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
