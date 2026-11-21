import { useState } from 'react'
import type { Lesson, Mode, PlayerApi, Segment } from '../types'

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
  activeSegment: Segment | null
  onExit: () => void
  onModeChange: (mode: Mode) => void
  onAddBookmark: () => Promise<number | null>
}

export default function DrivingMode({
  lesson,
  player,
  activeSegment,
  onExit,
  onModeChange,
  onAddBookmark,
}: Props) {
  const [confirm, setConfirm] = useState<string | null>(null)

  const handleBookmark = async () => {
    const mark = await onAddBookmark()
    if (mark === null) return
    setConfirm(`Bookmarked at ${formatTime(mark)}`)
    setTimeout(() => setConfirm(null), 2000)
  }

  const repeatSentence = () => {
    if (activeSegment && typeof activeSegment.startSec === 'number') {
      player.seek(activeSegment.startSec)
      player.play()
      return
    }
    player.skip(-5)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg px-4 pb-6 pt-4">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onExit}
          className="rounded-sm border border-line px-3 py-2 text-sm text-muted"
        >
          ✕ Exit
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm text-muted" dir="ltr">
          {lesson.title}
        </p>
        <button
          type="button"
          onClick={() => onModeChange('study')}
          className="rounded-sm border border-line px-3 py-2 text-sm text-muted"
        >
          Study Mode
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted" dir="ltr">
        <span className="tabular-nums">{formatTime(player.currentTime)}</span>
        <span className="truncate px-4">{lesson.source}</span>
        <span className="tabular-nums">{formatTime(player.duration)}</span>
      </div>

      <input
        type="range"
        min={0}
        max={player.duration || 0}
        step={1}
        value={player.currentTime}
        onChange={(event) => player.seek(Number(event.target.value))}
        className="mt-3 w-full"
        aria-label="Seek"
      />

      <div className="flex flex-1 flex-col justify-center gap-5 py-6">
        <button
          type="button"
          onClick={player.toggle}
          className="flex min-h-[140px] w-full items-center justify-center rounded-sm border-2 border-ink bg-ink text-7xl font-semibold text-bg transition-transform active:scale-[0.99]"
          aria-label={player.playing ? 'Pause' : 'Play'}
        >
          {player.playing ? '❚❚' : '▶'}
        </button>

        <div className="grid grid-cols-2 gap-5">
          {lesson.transcribed ? (
            <button
              type="button"
              onClick={repeatSentence}
              className="min-h-[92px] rounded-sm border-2 border-line bg-card px-2 text-lg font-semibold leading-tight text-ink transition-transform active:scale-[0.99]"
            >
              ↺ Repeat
              <span className="mt-1 block text-xs font-normal text-muted">Sentence</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => player.skip(-5)}
              className="min-h-[92px] rounded-sm border-2 border-line bg-card text-2xl font-semibold text-ink transition-transform active:scale-[0.99]"
            >
              −5s
            </button>
          )}
          <button
            type="button"
            onClick={() => player.skip(5)}
            className="min-h-[92px] rounded-sm border-2 border-line bg-card text-2xl font-semibold text-ink transition-transform active:scale-[0.99]"
          >
            +5s
          </button>
        </div>

        <button
          type="button"
          onClick={player.cycleRate}
          className="min-h-[80px] w-full rounded-sm border-2 border-line bg-card text-xl font-semibold text-ink transition-transform active:scale-[0.99]"
        >
          Speed · {player.rate.toFixed(2)}x
        </button>
      </div>

      <button
        type="button"
        onClick={() => void handleBookmark()}
        className="min-h-[88px] w-full rounded-sm border-2 border-ink bg-card text-lg font-semibold uppercase tracking-wider text-ink transition-transform active:scale-[0.99]"
      >
        {confirm ?? 'Bookmark Moment'}
      </button>
    </div>
  )
}