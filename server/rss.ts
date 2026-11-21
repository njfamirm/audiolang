import type { Lesson, Segment } from './store'
import { randomUUID } from './crypto'

/**
 * Free podcast RSS sources. No TTS, no paid feeds: plain public RSS.
 * Parsing is done with plain fetch() + tag extraction so it runs on Workers
 * without `rss-parser` or any Node-only dependency.
 */
export const FEEDS: ReadonlyArray<{ source: string; url: string }> = [
  { source: 'BBC 6 Minute English', url: 'https://podcasts.files.bbci.co.uk/p02pc9tn.rss' },
  { source: 'BBC The English We Speak', url: 'https://podcasts.files.bbci.co.uk/p02pc9zn.rss' },
  {
    source: 'VOA Learning English',
    url: 'https://learningenglish.voanews.com/podcast/?zoneId=1689',
  },
]

const FEED_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AudioLang/2.0; +cloudflare-worker)',
  Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, '. ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split raw text into clean, speakable sentences.
 * Deliberately simple: split after . ! ? when followed by a capital letter,
 * then drop fragments that are too short to be useful for study.
 */
export function splitSentences(text: string): string[] {
  const cleaned = text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const rough = cleaned
    .replace(/([.!?])\s+(?=["'(\[]?[A-Z0-9])/g, '$1\n')
    .replace(/\s*\n\s*/g, '\n')
    .split('\n')

  const sentences: string[] = []
  for (const part of rough) {
    const sentence = part
      .replace(/^[\s\-–—•*"'\u201c\u2018]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!sentence) continue
    if (sentence.length < 12) continue
    if (sentence.split(' ').length < 3) continue
    if (!/[a-zA-Z]{2}/.test(sentence)) continue
    if (/\b(https?:\/\/|www\.)\S*/i.test(sentence)) continue
    if (/\b(subscribe|download the|click here|advertisement)\b/i.test(sentence)) continue
    sentences.push(sentence)
  }
  return sentences
}

export function buildSegments(text: string, max = 40): Segment[] {
  return splitSentences(text)
    .slice(0, max)
    .map((sentence, index) => ({
      id: randomUUID(),
      index,
      text: sentence,
      explanationFa: null,
    }))
}

function firstTag(block: string, name: string): string {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')
  const match = block.match(pattern)
  return match?.[1] ?? ''
}

function unwrapCdata(value: string): string {
  const match = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return match ? match[1] : value
}

function pickAudioUrl(item: string): string | null {
  const enclosures = item.match(/<enclosure\b[^>]*>/gi) ?? []
  for (const enclosure of enclosures) {
    const url = enclosure.match(/\burl="([^"]+)"/i)?.[1]
    if (!url) continue
    const type = enclosure.match(/\btype="([^"]+)"/i)?.[1] ?? ''
    if (type.includes('audio') || /\.(mp3|m4a|ogg)(\?|$)/i.test(url)) return url
  }
  return null
}

function pickText(item: string): string {
  const candidates = [
    firstTag(item, 'content:encoded'),
    firstTag(item, 'itunes:summary'),
    firstTag(item, 'description'),
  ]
  let best = ''
  for (const candidate of candidates) {
    if (!candidate) continue
    const plain = stripHtml(unwrapCdata(candidate))
    if (plain.length > best.length) best = plain
  }
  return best
}

function parseItems(xml: string, source: string, perFeed: number): Lesson[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  const lessons: Lesson[] = []

  for (const item of items) {
    if (lessons.length >= perFeed) break

    const audioUrl = pickAudioUrl(item)
    if (!audioUrl) continue

    const text = pickText(item)
    if (!text) continue

    const segments = buildSegments(text)
    if (segments.length === 0) continue

    const title = stripHtml(unwrapCdata(firstTag(item, 'title'))).trim() || 'Untitled episode'
    const publishedRaw = unwrapCdata(firstTag(item, 'pubDate')).trim()
    const published = new Date(publishedRaw)
    const publishedAt = Number.isNaN(published.getTime())
      ? new Date().toISOString()
      : published.toISOString()

    lessons.push({
      id: randomUUID(),
      title,
      source,
      audioUrl: decodeEntities(audioUrl),
      publishedAt,
      lastPositionSec: 0,
      bookmarks: [],
      segments,
      transcribed: false,
    })
  }

  return lessons
}

/** Fetch the latest episodes from every reachable feed, deduplicated by audio URL. */
export async function fetchEpisodes(perFeed = 5): Promise<Lesson[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const response = await fetch(feed.url, {
        headers: FEED_HEADERS,
        redirect: 'follow',
        cf: { cacheTtl: 600, cacheEverything: true },
      })
      if (!response.ok) throw new Error(`${feed.source}: HTTP ${response.status}`)
      const xml = await response.text()
      return parseItems(xml, feed.source, perFeed)
    }),
  )

  const lessons: Lesson[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') lessons.push(...result.value)
    else console.warn('[rss] feed failed:', result.reason?.message ?? result.reason)
  }
  return lessons
}