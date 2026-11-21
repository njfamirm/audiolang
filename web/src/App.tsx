import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AddLessonModal from './components/AddLessonModal'
import DrivingMode from './components/DrivingMode'
import LessonList from './components/LessonList'
import StudyMode from './components/StudyMode'
import type { ExplanationFa, Lesson, Mode, PlayerApi, VocabItem } from './types'

const SPEEDS: number[] = [0.75, 1, 1.25]

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload as T
}

export default function App() {
  // --- Audio engine (single persistent element, lives for the whole session) ---
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const pendingSeekRef = useRef(0)
  const skipRef = useRef<(delta: number) => void>(() => {})

  const [lessons, setLessons] = useState<Lesson[]>([])
  const [vocab, setVocab] = useState<VocabItem[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('study')

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)

  const [booted, setBooted] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [transcribingId, setTranscribingId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [aiConfigured, setAiConfigured] = useState(true)
  const [transcriptionConfigured, setTranscriptionConfigured] = useState(true)

  const currentLesson = useMemo(
    () => lessons.find((lesson) => lesson.id === currentId) ?? null,
    [lessons, currentId],
  )

  /** Sentence currently being played, based on Whisper timestamps. */
  const activeSegment = useMemo(() => {
    if (!currentLesson) return null
    return (
      currentLesson.segments.find(
        (segment) =>
          segment.startSec !== undefined &&
          currentTime >= segment.startSec &&
          currentTime < (segment.endSec ?? Number.POSITIVE_INFINITY),
      ) ?? null
    )
  }, [currentLesson, currentTime])

  // --- Boot: load lessons, vocab and health ---
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [lessonData, vocabData, health] = await Promise.all([
          api<{ lessons: Lesson[] }>('/api/lessons'),
          api<{ vocab: VocabItem[] }>('/api/vocab'),
          api<{ aiConfigured: boolean; transcriptionConfigured: boolean }>('/api/health').catch(
            () => null,
          ),
        ])
        if (cancelled) return
        setLessons(lessonData.lessons ?? [])
        setVocab(vocabData.vocab ?? [])
        if (health) {
          setAiConfigured(Boolean(health.aiConfigured))
          setTranscriptionConfigured(Boolean(health.transcriptionConfigured))
        }
      } catch (error) {
        if (!cancelled) {
          setFatal(error instanceof Error ? error.message : 'Could not reach the API.')
        }
      } finally {
        if (!cancelled) setBooted(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const saveProgress = useCallback(async (lessonId: string, seconds: number) => {
    try {
      await api(`/api/lessons/${lessonId}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ lastPositionSec: seconds }),
      })
      setLessons((previous) =>
        previous.map((lesson) =>
          lesson.id === lessonId ? { ...lesson, lastPositionSec: seconds } : lesson,
        ),
      )
    } catch {
      // Progress saving is best-effort.
    }
  }, [])

  // Auto-save position every 5 seconds while playing.
  useEffect(() => {
    const timer = setInterval(() => {
      const audio = audioRef.current
      const id = currentIdRef.current
      if (!audio || !id || audio.paused || !Number.isFinite(audio.currentTime)) return
      void saveProgress(id, Math.round(audio.currentTime))
    }, 5000)
    return () => clearInterval(timer)
  }, [saveProgress])

  // Flush on tab hide / unload.
  useEffect(() => {
    const flush = () => {
      const audio = audioRef.current
      const id = currentIdRef.current
      if (!audio || !id || !Number.isFinite(audio.currentTime)) return
      void fetch(`/api/lessons/${id}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastPositionSec: Math.round(audio.currentTime) }),
        keepalive: true,
      })
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  // Remember where to resume when the lesson changes.
  useEffect(() => {
    const lesson = lessons.find((item) => item.id === currentId)
    pendingSeekRef.current = lesson?.lastPositionSec ?? 0
    setCurrentTime(0)
    setDuration(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  // --- Player controls ---
  const play = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    void audio.play().catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotAllowedError') {
        setToast('Tap play to start — the browser blocked autoplay.')
      } else {
        setToast('Could not play this audio yet — it may still be loading.')
      }
    })
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) play()
    else audio.pause()
  }, [play])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const max = Number.isFinite(audio.duration) ? audio.duration : seconds
    const next = Math.min(Math.max(seconds, 0), Math.max(max, 0))
    audio.currentTime = next
    setCurrentTime(next)
  }, [])

  const skip = useCallback(
    (delta: number) => {
      const audio = audioRef.current
      if (!audio) return
      seek(audio.currentTime + delta)
    },
    [seek],
  )
  useEffect(() => {
    skipRef.current = skip
  }, [skip])

  const cycleRate = useCallback(() => {
    setRate((previous) => {
      const index = SPEEDS.indexOf(previous)
      return SPEEDS[(index + 1) % SPEEDS.length]
    })
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate])

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = rate
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const target = pendingSeekRef.current
    if (target > 1 && (!Number.isFinite(audio.duration) || target < audio.duration - 1)) {
      try {
        audio.currentTime = target
      } catch {
        // Ignore: some streams reject seeking before enough data is buffered.
      }
    }
    pendingSeekRef.current = 0
    setCurrentTime(audio.currentTime)
  }, [rate])

  // --- Media Session API (car steering wheel + Bluetooth headsets) ---
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentLesson) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentLesson.title,
      artist: currentLesson.source,
      album: 'AudioLang',
    })
  }, [currentLesson])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    session.setActionHandler('play', () => void audioRef.current?.play())
    session.setActionHandler('pause', () => audioRef.current?.pause())
    session.setActionHandler('seekbackward', () => skipRef.current(-5))
    session.setActionHandler('seekforward', () => skipRef.current(5))
    return () => {
      session.setActionHandler('play', null)
      session.setActionHandler('pause', null)
      session.setActionHandler('seekbackward', null)
      session.setActionHandler('seekforward', null)
    }
  }, [])

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    }
  }, [playing])

  // --- Data actions ---
  const openLesson = useCallback(
    (id: string) => {
      const audio = audioRef.current
      const previousId = currentIdRef.current
      if (audio && previousId && previousId !== id && Number.isFinite(audio.currentTime)) {
        void saveProgress(previousId, Math.round(audio.currentTime))
      }
      currentIdRef.current = id
      setCurrentId(id)
      setMode('study')
    },
    [saveProgress],
  )

  const exitLesson = useCallback(() => {
    const audio = audioRef.current
    const id = currentIdRef.current
    if (audio && id && Number.isFinite(audio.currentTime)) {
      void saveProgress(id, Math.round(audio.currentTime))
    }
    audio?.pause()
    currentIdRef.current = null
    setCurrentId(null)
    setMode('study')
  }, [saveProgress])

  const addBookmark = useCallback(async (): Promise<number | null> => {
    const audio = audioRef.current
    const id = currentIdRef.current
    if (!audio || !id) return null
    const mark = Math.round(audio.currentTime)
    try {
      const data = await api<{ lesson: Lesson }>(`/api/lessons/${id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ addBookmarkSec: mark }),
      })
      setLessons((previous) => previous.map((lesson) => (lesson.id === id ? data.lesson : lesson)))
      return mark
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not save bookmark.')
      return null
    }
  }, [])

  const transcribe = useCallback(async (lessonId: string, durationSec: number) => {
    setTranscribingId(lessonId)
    try {
      const data = await api<{ lesson: Lesson; cached: boolean }>(
        `/api/lessons/${lessonId}/transcribe`,
        { method: 'POST', body: JSON.stringify({ durationSec: Math.round(durationSec) }) },
      )
      setLessons((previous) =>
        previous.map((lesson) => (lesson.id === lessonId ? data.lesson : lesson)),
      )
      setToast(
        data.cached
          ? 'Transcript already cached'
          : `Full transcript synced · ${data.lesson.segments.length} sentences`,
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Transcription failed')
    } finally {
      setTranscribingId(null)
    }
  }, [])

  const align = useCallback(async (lessonId: string, durationSec: number) => {
    setTranscribingId(lessonId)
    try {
      const data = await api<{ lesson: Lesson; cached: boolean }>(
        `/api/lessons/${lessonId}/align`,
        { method: 'POST', body: JSON.stringify({ durationSec: Math.round(durationSec) }) },
      )
      setLessons((previous) =>
        previous.map((lesson) => (lesson.id === lessonId ? data.lesson : lesson)),
      )
      setToast(
        data.cached ? 'Timings already aligned' : 'Timings aligned — no API call was made',
      )
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not align timings')
    } finally {
      setTranscribingId(null)
    }
  }, [])

  const explain = useCallback(async (segmentId: string): Promise<ExplanationFa> => {
    const lessonId = currentIdRef.current
    if (!lessonId) throw new Error('No lesson is open.')
    const data = await api<{ explanationFa: ExplanationFa }>(
      `/api/lessons/${lessonId}/segments/${segmentId}/explain`,
      { method: 'POST' },
    )
    setLessons((previous) =>
      previous.map((lesson) =>
        lesson.id !== lessonId
          ? lesson
          : {
              ...lesson,
              segments: lesson.segments.map((segment) =>
                segment.id === segmentId
                  ? { ...segment, explanationFa: data.explanationFa }
                  : segment,
              ),
            },
      ),
    )
    return data.explanationFa
  }, [])

  const saveWord = useCallback(
    async (payload: { word: string; contextSentence: string; meaningFa: string }) => {
      const data = await api<{ vocab: VocabItem[] }>('/api/vocab', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setVocab(data.vocab)
      setToast(`Saved “${payload.word}” to vocabulary`)
    },
    [],
  )

  const deleteVocab = useCallback(async (id: string) => {
    const data = await api<{ vocab: VocabItem[] }>(`/api/vocab/${id}`, { method: 'DELETE' })
    setVocab(data.vocab)
  }, [])

  const syncPodcasts = useCallback(async () => {
    setSyncing(true)
    try {
      const data = await api<{ lessons: Lesson[]; added: number }>('/api/lessons/sync', {
        method: 'POST',
      })
      setLessons(data.lessons)
      setToast(data.added > 0 ? `Added ${data.added} new episode(s)` : 'No new episodes found')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [])

  const addCustomLesson = useCallback(
    async (payload: { title: string; audioUrl: string; transcript: string }) => {
      const data = await api<{ lesson: Lesson; lessons: Lesson[] }>('/api/lessons/custom', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setLessons(data.lessons)
      setAddOpen(false)
      openLesson(data.lesson.id)
      setToast('Custom lesson added')
    },
    [openLesson],
  )

  const player: PlayerApi = useMemo(
    () => ({ playing, currentTime, duration, rate, play, toggle, seek, skip, cycleRate }),
    [playing, currentTime, duration, rate, play, toggle, seek, skip, cycleRate],
  )

  return (
    <div className="min-h-full">
      <audio
        ref={audioRef}
        src={currentLesson ? `/api/audio?url=${encodeURIComponent(currentLesson.audioUrl)}` : undefined}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setToast('Could not load audio — the source may be offline or blocked.')}
      />

      {!booted ? (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted">
          Loading…
        </div>
      ) : fatal ? (
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <h1 className="text-lg font-medium text-ink">API unreachable</h1>
          <p className="mt-2 text-sm text-muted">{fatal}</p>
          <p className="mt-4 text-xs text-neutral-600">
            Make sure both servers are running: <span className="text-ink">npm run dev</span>
          </p>
        </div>
      ) : currentLesson ? (
        mode === 'study' ? (
          <StudyMode
            lesson={currentLesson}
            player={player}
            activeSegmentId={activeSegment?.id ?? null}
            aiConfigured={aiConfigured}
            transcriptionConfigured={transcriptionConfigured}
            transcribing={transcribingId === currentLesson.id}
            onExit={exitLesson}
            onModeChange={setMode}
            onAddBookmark={addBookmark}
            onTranscribe={() => void transcribe(currentLesson.id, duration)}
            onAlign={() => void align(currentLesson.id, duration)}
            onExplain={explain}
            onSaveWord={saveWord}
          />
        ) : (
          <DrivingMode
            lesson={currentLesson}
            player={player}
            activeSegment={activeSegment}
            onExit={exitLesson}
            onModeChange={setMode}
            onAddBookmark={addBookmark}
          />
        )
      ) : (
        <LessonList
          lessons={lessons}
          vocab={vocab}
          syncing={syncing}
          aiConfigured={aiConfigured}
          transcriptionConfigured={transcriptionConfigured}
          onOpen={openLesson}
          onSync={() => void syncPodcasts()}
          onAdd={() => setAddOpen(true)}
          onDeleteVocab={(id) => void deleteVocab(id)}
        />
      )}

      {addOpen && <AddLessonModal onClose={() => setAddOpen(false)} onSubmit={addCustomLesson} />}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-sm border border-line bg-card px-4 py-2 text-sm text-ink shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}