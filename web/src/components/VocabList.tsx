import { useMemo, useState } from 'react'
import type { VocabItem } from '../types'

type Rating = 'again' | 'good' | 'easy'

interface Props {
  vocab: VocabItem[]
  onBack: () => void
  onDelete: (id: string) => void
  onReview: (id: string, rating: Rating) => Promise<void>
}

function stageLabel(item: VocabItem): 'New' | 'Learning' | 'Mastered' {
  if (item.stage === 'mastered') return 'Mastered'
  if (item.stage === 'learning') return 'Learning'
  return 'New'
}

function stageClass(item: VocabItem): string {
  const label = stageLabel(item)
  if (label === 'Mastered') return 'border-emerald-500/40 text-emerald-400'
  if (label === 'Learning') return 'border-line text-ink'
  return 'border-line text-muted'
}

export default function VocabList({ vocab, onBack, onDelete, onReview }: Props) {
  const [queue, setQueue] = useState<string[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  const dueIds = useMemo(() => {
    const now = Date.now()
    return vocab
      .filter((item) => !item.nextReviewAt || new Date(item.nextReviewAt).getTime() <= now)
      .map((item) => item.id)
  }, [vocab])

  const stats = useMemo(() => {
    let mastered = 0
    let learning = 0
    for (const item of vocab) {
      if (item.stage === 'mastered') mastered += 1
      else if (item.stage === 'learning') learning += 1
    }
    return { mastered, learning, due: dueIds.length }
  }, [vocab, dueIds])

  const startReview = () => {
    setQueue(dueIds)
    setIndex(0)
    setRevealed(false)
  }

  const rate = async (rating: Rating) => {
    const id = queue?.[index]
    if (!id || busy) return
    setBusy(true)
    try {
      await onReview(id, rating)
      setRevealed(false)
      setIndex((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  // --- Review flashcard view ---
  if (queue !== null) {
    const current = queue[index] ? vocab.find((item) => item.id === queue[index]) : undefined
    const done = index >= queue.length || !current

    return (
      <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setQueue(null)}
            className="rounded-sm border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
          >
            ← Vocabulary
          </button>
          {!done && (
            <span className="text-xs tabular-nums text-muted">
              {index + 1} / {queue.length}
            </span>
          )}
        </div>

        {done ? (
          <div className="rounded-md border border-line bg-card p-8 text-center">
            <p className="text-lg font-medium text-ink">Review complete</p>
            <p className="mt-1 text-sm text-muted">You reviewed {queue.length} word(s).</p>
            <button
              type="button"
              onClick={() => setQueue(null)}
              className="mt-4 rounded-sm border border-emerald-500 bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] transition-opacity hover:opacity-90"
            >
              Back to Vocabulary
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-card p-6">
            <p className="text-center text-2xl font-semibold text-ink" dir="ltr">
              {current.word}
            </p>
            {current.contextSentence && (
              <p className="mt-3 text-center text-sm italic text-muted" dir="ltr">
                {current.contextSentence}
              </p>
            )}

            {revealed ? (
              <div className="mt-6 border-t border-line pt-5">
                <p className="fa text-[15px] text-ink">{current.meaningFa || '—'}</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="mt-6 w-full rounded-sm border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-bg"
              >
                Show Answer
              </button>
            )}

            {revealed && (
              <div className="mt-6 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => void rate('again')}
                  disabled={busy}
                  className="rounded-sm border border-red-500/50 px-3 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                >
                  Again
                </button>
                <button
                  type="button"
                  onClick={() => void rate('good')}
                  disabled={busy}
                  className="rounded-sm border border-line bg-card px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:border-neutral-500 disabled:opacity-50"
                >
                  Good
                </button>
                <button
                  type="button"
                  onClick={() => void rate('easy')}
                  disabled={busy}
                  className="rounded-sm border border-emerald-500 bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Easy
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // --- List view ---
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
        >
          ← Library
        </button>
        <span className="text-xs text-muted">{vocab.length} saved</span>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-ink">Vocabulary</h1>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="rounded-md border border-line bg-card p-3 text-center">
          <p className="text-xl font-semibold tabular-nums text-emerald-400">{stats.mastered}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted">Mastered</p>
        </div>
        <div className="rounded-md border border-line bg-card p-3 text-center">
          <p className="text-xl font-semibold tabular-nums text-ink">{stats.learning}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted">Learning</p>
        </div>
        <div className="rounded-md border border-line bg-card p-3 text-center">
          <p className="text-xl font-semibold tabular-nums text-ink">{stats.due}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted">Due Now</p>
        </div>
      </div>

      {stats.due > 0 && (
        <button
          type="button"
          onClick={startReview}
          className="mt-4 w-full rounded-sm border border-emerald-500 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-opacity hover:opacity-90"
        >
          Start Review ({stats.due})
        </button>
      )}

      {vocab.length === 0 ? (
        <p className="mt-5 rounded-sm border border-dashed border-line p-8 text-center text-sm text-muted">
          No words yet. Open a lesson, tap a word in the transcript, and save it.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
          {vocab.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink" dir="ltr">
                    {item.word}
                  </p>
                  <span
                    className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${stageClass(item)}`}
                  >
                    {stageLabel(item)}
                  </span>
                </div>
                {item.meaningFa && <p className="fa mt-1 text-sm text-muted">{item.meaningFa}</p>}
                {item.contextSentence && (
                  <p className="mt-1.5 truncate text-xs text-neutral-500" dir="ltr">
                    {item.contextSentence}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="shrink-0 rounded-sm border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-neutral-500 hover:text-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
