import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AddLessonModal from './components/AddLessonModal'
import DrivingMode from './components/DrivingMode'
import LessonList from './components/LessonList'
import LoginScreen from './components/LoginScreen'
import StudyMode from './components/StudyMode'
import VocabList from './components/VocabList'
import { api, setUnauthorizedHandler } from './api'
import { navigate, parsePath, useRoutePath } from './router'
import type { ExplanationFa, Lesson, Mode, PlayerApi, VocabItem } from './types'

const SPEEDS: number[] = [0.75, 1, 1.25]

interface AuthState {
  checked: boolean
  required: boolean
  authenticated: boolean
}

export default function App() {
  // --- Audio engine (single persistent element, lives for the whole session) ---
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const pendingSeekRef = useRef(0)
  const seekAppliedRef = useRef<string | null>(null)
  const skipRef = useRef<(delta: number) => void>(() => {})
  /** Last known playback state, used to survive the live-URL → frozen-KV source swap. */
  const mediaStateRef = useRef({ time: 0, playing: false })
  const resumeAfterSwapRef = useRef(false)

  const [lessons, setLessons] = useState<Lesson[]>([])
  const [vocab, setVocab] = useState<VocabItem[]>([])
  const [auth, setAuth] = useState<AuthState>({
    checked: false,
    required: false,
    authenticated: false,
  })

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

  // --- URL routing ---
  const path = useRoutePath()
  const route = useMemo(() => parsePath(path), [path])
  const currentId = route.name === 'lesson' || route.name === 'drive' ? route.id : null
  const mode: Mode = route.name === 'drive' ? 'driving' : 'study'

  const currentLesson = useMemo(
    () => lessons.find((lesson) => lesson.id === currentId) ?? null,
    [lessons, currentId],
  )

  /**
   * Frozen audio (exact transcribed bytes) comes from KV with Range support; otherwise we keep
   * proxying the live feed URL server-side so `http://` podcast media still plays over HTTPS.
   */
  const audioSrc = currentLesson
    ? currentLesson.audioCached
      ? `/api/lessons/${currentLesson.id}/audio`
      : `/api/audio?url=${encodeURIComponent(currentLesson.audioUrl)}`
    : undefined

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

  // Any 401 from the API drops us straight back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth({ checked: true, required: true, authenticated: false }))
    return () => setUnauthorizedHandler(null)
  }, [])

  // --- Boot: discover auth mode first ---
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const me = await api<{ authenticated: boolean; authRequired: boolean }>('/api/auth/me')
        if (cancelled) return
        setAuth({
          checked: true,
          required: me.authRequired,
          authenticated: me.authenticated || !me.authRequired,
        })
      } catch {
        if (!cancelled) setAuth({ checked: true, required: false, authenticated: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // --- Load data once authenticated ---
  useEffect(() => {
    if (!auth.checked || !auth.authenticated) return
    let cancelled = false
    setBooted(false)
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
        setFatal(null)
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
  }, [auth.checked, auth.authenticated])

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

  /**
   * React to the lesson changing from the URL: save the outgoing lesson's position and pause
   * only when we truly leave a lesson. Switching `/lesson/x` ↔ `/lesson/x/drive` keeps playing.
   */
  useEffect(() => {
    const previous = currentIdRef.current
    if (previous && previous !== currentId) {
      const audio = audioRef.current
      if (audio && Number.isFinite(audio.currentTime)) {
        void saveProgress(previous, Math.round(audio.currentTime))
      }
    }
    currentIdRef.current = currentId
    if (!currentId) audioRef.current?.pause()
  }, [currentId, saveProgress])

  // Remember where to resume once the lesson object is available (handles deep links/reloads).
  useEffect(() => {
    if (!currentId) {
      seekAppliedRef.current = null
      return
    }
    const lesson = lessons.find((item) => item.id === currentId)
    if (!lesson || seekAppliedRef.current === currentId) return
    seekAppliedRef.current = currentId
    pendingSeekRef.current = lesson.lastPositionSec ?? 0
    setCurrentTime(0)
    setDuration(0)
  }, [currentId, lessons])

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

    // After a live-URL → frozen-KV source swap, resume where the listener left off.
    if (resumeAfterSwapRef.current) {
      resumeAfterSwapRef.current = false
      void audio.play().catch(() => {
        // Autoplay may be blocked; the user can tap play.
      })
    }
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

      // If the open lesson just got its audio frozen, preserve position + playback across the
      // source swap from the live feed URL to the KV route.
      if (data.lesson.audioCached && currentIdRef.current === lessonId) {
        const audio = audioRef.current
        pendingSeekRef.current =
          audio && Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : mediaStateRef.current.time
        resumeAfterSwapRef.current = audio ? !audio.paused : mediaStateRef.current.playing
      }

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
      try {
        const data = await api<{ vocab: VocabItem[] }>('/api/vocab', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setVocab(data.vocab)
        setToast(`Saved “${payload.word}” to vocabulary`)
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Could not save word.')
        throw error
      }
    },
    [],
  )

  const defineWord = useCallback(async (word: string, contextSentence: string) => {
    try {
      const data = await api<{ vocab: VocabItem[] }>('/api/vocab/define', {
        method: 'POST',
        body: JSON.stringify({ word, contextSentence }),
      })
      setVocab(data.vocab)
      setToast(`Saved “${word}” to vocabulary`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not translate this word.')
      throw error
    }
  }, [])

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
      navigate(`/lesson/${data.lesson.id}`)
      setToast('Custom lesson added')
    },
    [],
  )

  const login = useCallback(async (passcode: string) => {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passcode }) })
    setAuth({ checked: true, required: true, authenticated: true })
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch {
      // Clearing the cookie is best-effort; still lock the UI.
    }
    audioRef.current?.pause()
    setAuth((previous) => ({ ...previous, authenticated: false }))
  }, [])

  /** Live audio clock for word highlighting — bypasses React's 4 Hz timeupdate throttling. */
  const now = useCallback(() => {
    const audio = audioRef.current
    return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0
  }, [])

  const player: PlayerApi = useMemo(
    () => ({ playing, now, currentTime, duration, rate, play, toggle, seek, skip, cycleRate }),
    [playing, now, currentTime, duration, rate, play, toggle, seek, skip, cycleRate],
  )

  const renderLesson = () => {
    if (!currentLesson) {
      return (
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <h1 className="text-lg font-medium text-ink">Lesson not found</h1>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-4 rounded-sm border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-neutral-500 hover:text-ink"
          >
            ← Library
          </button>
        </div>
      )
    }

    if (mode === 'driving') {
      return (
        <DrivingMode
          lesson={currentLesson}
          player={player}
          activeSegment={activeSegment}
          onExit={() => navigate('/')}
          onModeChange={() => navigate(`/lesson/${currentLesson.id}`)}
          onAddBookmark={addBookmark}
        />
      )
    }

    return (
      <StudyMode
        lesson={currentLesson}
        player={player}
        activeSegmentId={activeSegment?.id ?? null}
        aiConfigured={aiConfigured}
        transcriptionConfigured={transcriptionConfigured}
        transcribing={transcribingId === currentLesson.id}
        onExit={() => navigate('/')}
        onModeChange={() => navigate(`/lesson/${currentLesson.id}/drive`)}
        onAddBookmark={addBookmark}
        onTranscribe={() => void transcribe(currentLesson.id, duration)}
        onAlign={() => void align(currentLesson.id, duration)}
        onExplain={explain}
        onSaveWord={saveWord}
        onDefineWord={defineWord}
      />
    )
  }

  return (
    <div className="min-h-full">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={() => {
          const time = audioRef.current?.currentTime ?? 0
          mediaStateRef.current.time = time
          setCurrentTime(time)
        }}
        onPlay={() => {
          mediaStateRef.current.playing = true
          setPlaying(true)
        }}
        onPause={() => {
          mediaStateRef.current.playing = false
          setPlaying(false)
        }}
        onEnded={() => {
          mediaStateRef.current.playing = false
          setPlaying(false)
        }}
        onError={() => setToast('Could not load audio — the source may be offline or blocked.')}
      />

      {!auth.checked ? (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted">
          Loading…
        </div>
      ) : auth.required && !auth.authenticated ? (
        <LoginScreen onSubmit={login} />
      ) : !booted ? (
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
      ) : route.name === 'vocab' ? (
        <VocabList
          vocab={vocab}
          onBack={() => navigate('/')}
          onDelete={(id) => void deleteVocab(id)}
        />
      ) : currentId ? (
        renderLesson()
      ) : (
        <LessonList
          lessons={lessons}
          vocabCount={vocab.length}
          syncing={syncing}
          aiConfigured={aiConfigured}
          transcriptionConfigured={transcriptionConfigured}
          authRequired={auth.required}
          onOpen={(id) => navigate(`/lesson/${id}`)}
          onOpenVocab={() => navigate('/vocab')}
          onLock={() => void logout()}
          onSync={() => void syncPodcasts()}
          onAdd={() => setAddOpen(true)}
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
