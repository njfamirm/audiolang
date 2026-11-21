import { useState } from 'react'

interface Props {
  onClose: () => void
  onSubmit: (payload: { title: string; audioUrl: string; transcript: string }) => Promise<void>
}

export default function AddLessonModal({ onClose, onSubmit }: Props) {
  const [title, setTitle] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim() || !audioUrl.trim() || !transcript.trim()) {
      setError('All three fields are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        title: title.trim(),
        audioUrl: audioUrl.trim(),
        transcript: transcript.trim(),
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save the lesson.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-sm border border-line bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-ink">New custom lesson</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-line px-2 py-1 text-xs text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">Title</span>
            <input
              type="text"
              dir="ltr"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="My English episode"
              className="rounded-sm border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">Audio URL (MP3)</span>
            <input
              type="url"
              dir="ltr"
              value={audioUrl}
              onChange={(event) => setAudioUrl(event.target.value)}
              placeholder="https://example.com/episode.mp3"
              className="rounded-sm border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">
              Transcript (split into sentences automatically)
            </span>
            <textarea
              dir="ltr"
              rows={8}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Paste the English transcript here. Each sentence becomes a study card."
              className="resize-y rounded-sm border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-400/80">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-sm border border-ink bg-ink px-4 py-2 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Add Lesson'}
          </button>
        </div>
      </div>
    </div>
  )
}
