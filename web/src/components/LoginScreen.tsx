import { useState } from 'react'

interface Props {
  onSubmit: (passcode: string) => Promise<void>
}

export default function LoginScreen({ onSubmit }: Props) {
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!passcode.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(passcode.trim())
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not unlock.')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-sm border border-line bg-card">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth={1.8}
            >
              <path d="M4 10v4M8 6v12M12 3v18M16 6v12M20 10v4" />
            </svg>
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">AudioLang</h1>
          <p className="mt-1 text-sm text-muted">Enter your passcode to continue.</p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            type="password"
            dir="ltr"
            autoFocus
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="Passcode"
            className="rounded-sm border border-line bg-panel px-4 py-3 text-center text-sm tracking-widest text-ink placeholder:tracking-normal placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !passcode.trim()}
            className="rounded-sm border border-ink bg-ink px-4 py-3 text-sm font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>

        {error && <p className="mt-3 text-center text-sm text-red-400/80">{error}</p>}
      </div>
    </div>
  )
}
