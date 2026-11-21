import { useEffect, useState } from 'react'

/** Route shapes supported by the app, parsed from `window.location.pathname`. */
export type Route =
  | { name: 'library' }
  | { name: 'vocab' }
  | { name: 'lesson'; id: string }
  | { name: 'drive'; id: string }

export function parsePath(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/'
  if (clean === '/vocab') return { name: 'vocab' }
  const drive = clean.match(/^\/lesson\/([^/]+)\/drive$/)
  if (drive) return { name: 'drive', id: decodeURIComponent(drive[1]) }
  const lesson = clean.match(/^\/lesson\/([^/]+)$/)
  if (lesson) return { name: 'lesson', id: decodeURIComponent(lesson[1]) }
  return { name: 'library' }
}

/** Push a new history entry and notify listeners (popstate covers Back/Forward). */
export function navigate(path: string): void {
  if (window.location.pathname + window.location.search === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Subscribe to the current pathname. Keeps the app in sync with Back/Forward. */
export function useRoutePath(): string {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])
  return path
}
