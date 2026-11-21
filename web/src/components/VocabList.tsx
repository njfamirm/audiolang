import type { VocabItem } from '../types'

interface Props {
  vocab: VocabItem[]
  onBack: () => void
  onDelete: (id: string) => void
}

export default function VocabList({ vocab, onBack, onDelete }: Props) {
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

      {vocab.length === 0 ? (
        <p className="mt-4 rounded-sm border border-dashed border-line p-8 text-center text-sm text-muted">
          No words yet. Open a lesson, tap a word in the transcript, and save it.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-line overflow-hidden rounded-sm border border-line bg-card">
          {vocab.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink" dir="ltr">
                  {item.word}
                </p>
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
