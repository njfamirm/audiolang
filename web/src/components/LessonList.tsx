import { useState } from 'react'
import type { Lesson, VocabItem } from '../types'

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
  vocab: VocabItem[]
  syncing: boolean
  aiConfigured: boolean
  transcriptionConfigured: boolean
  onOpen: (id: string) => void
  onSync: () => void
  onAdd: () => void
  onDeleteVocab: (id: string) => void
}

export default function LessonList({
  lessons,
  vocab,
  syncing,
  aiConfigured,
  transcriptionConfigured,
  onOpen,
  onSync,
  onAdd,
  onDeleteVocab,
}: Props) {
  const [showVocab, setShowVocab] = useState(false)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">AudioLang</h1>
        <p className="mt-1 text-sm text-muted">
          Listen while you drive, study when you park. Free podcast feeds — no TTS, no cloud.
        </p>
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
          onClick={() => setShowVocab((value) => !value)}
          className="ml-auto rounded-sm border border-line px-3 py-2 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
        >
          Vocabulary ({vocab.length})
        </button>
      </div>

      {(!aiConfigured || !transcriptionConfigured) && (
        <div className="mb-5 flex flex-col gap-1 rounded-sm border border-line bg-card p-3 text-xs text-muted">
          {!transcriptionConfigured && (
            <p>
              Full transcripts are off. Add{' '}
              <span className="text-ink">OPENROUTER_API_KEY</span> to{' '}
              <span className="text-ink">.dev.vars</span> to unlock timestamped, synced
              transcripts.
            </p>
          )}
          {!aiConfigured && (
            <p>
              Persian explanations are off. Add{' '}
              <span className="text-ink">OPENROUTER_API_KEY</span> to{' '}
              <span className="text-ink">.dev.vars</span> and restart.
            </p>
          )}
        </div>
      )}

      {showVocab && (
        <section className="mb-6 rounded-sm border border-line bg-card">
          <h2 className="border-b border-line px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
            Saved words
          </h2>
          {vocab.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">
              No words yet. Open a lesson, tap a sentence, and save the words you want to keep.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {vocab.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink" dir="ltr">
                      {item.word}
                    </p>
                    {item.meaningFa && <p className="fa mt-1 text-sm text-muted">{item.meaningFa}</p>}
                    {item.contextSentence && (
                      <p className="mt-1 truncate text-xs text-neutral-500" dir="ltr">
                        {item.contextSentence}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteVocab(item.id)}
                    className="shrink-0 rounded-sm border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
