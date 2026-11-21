import type { Env } from './env'
import { extractJson } from './json'
import type { ExplanationFa } from './store'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'deepseek/deepseek-chat'

export function hasApiKey(env: Env): boolean {
  return Boolean(env.OPENROUTER_API_KEY?.trim())
}

export function currentModel(env: Env): string {
  return env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL
}

const SYSTEM_PROMPT = `تو یک مترجم و معلمِ زبانِ انگلیسیِ حرفه‌ای هستی که فارسی را مثل یک فارسی‌زبانِ بومی و امروزی حرف می‌زند.
برای جمله‌ی انگلیسی که به تو داده می‌شود، فقط و فقط یک آبجکت JSON معتبر برگردان؛ بدون مقدمه، بدون توضیح اضافه، بدون بلوک کد و بدون مارک‌داون.
ساختار دقیق خروجی:
{
  "meaning": "ترجمه‌ی روان و طبیعی فارسی",
  "grammar": "توضیح خیلی کوتاه گرامر یا ساختار جمله به فارسی",
  "idioms": ["اصطلاح یا لغت کلیدی: معنی فارسی"]
}
قواعد:
- «meaning» باید طوری باشد که یک فارسی‌زبانِ بومی همان را در گفت‌وگو می‌گفت؛ ترجمه‌ی کلمه‌به‌کلمه و کتابی ممنوع.
- ترتیب و ریتم جمله‌ی فارسی را طبیعی کن؛ ساختار انگلیسی را با زور به فارسی منتقل نکن.
- اصطلاح‌ها را با معادلِ فرهنگی و روان جای‌گزین کن، نه ترجمه‌ی تحت‌اللفظی.
- لحن: دوستانه، روشن و امروزی؛ برای جمله‌های شوخ یا محاوره‌ای، لحنِ محاوره‌ایِ مناسب انتخاب کن.
- «grammar» حداکثر دو جمله‌ی کوتاه و ساده و فقط درباره‌ی نکته‌ی کلیدیِ ساختار جمله.
- «idioms» بین ۰ تا ۴ مورد؛ هر مورد «عبارت انگلیسی: معنی روان فارسی». اگر اصطلاح یا لغت کلیدی نبود، آرایه‌ی خالی بده.
- خروجی صرفاً JSON باشد.`

function coerce(value: unknown): ExplanationFa {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Malformed explanation payload')
  }
  const data = value as Record<string, unknown>
  const meaning = typeof data.meaning === 'string' ? data.meaning.trim() : ''
  const grammar = typeof data.grammar === 'string' ? data.grammar.trim() : ''
  const idioms = Array.isArray(data.idioms)
    ? data.idioms.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  if (!meaning) throw new Error('Missing "meaning" in model response')
  return { meaning, grammar: grammar || '—', idioms }
}

/** Ask OpenRouter for a Persian explanation of a single English sentence. */
export async function explainSentence(
  env: Env,
  sentence: string,
  lessonTitle?: string,
): Promise<ExplanationFa> {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it to .dev.vars and restart.')
  }

  const userPrompt = lessonTitle
    ? `عنوان درس: ${lessonTitle}\nجمله: ${sentence}`
    : `جمله: ${sentence}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  headers['HTTP-Referer'] = 'https://audiolang.local'
  headers['X-Title'] = 'AudioLang'

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: currentModel(env),
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`OpenRouter error ${response.status}: ${detail.slice(0, 300)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenRouter')

  return coerce(extractJson(content))
}