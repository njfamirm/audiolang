import type { Env } from './env'
import { extractJson } from './json'
import type { ExplanationFa } from './store'

/**
 * Persian explanations + word definitions run on the Workers AI binding (`AI`), the same
 * no-key runtime that powers Whisper. This is the app's single AI method: OpenRouter is not
 * called from Workers because its edge blocks Cloudflare Workers egress (403 "Access denied by
 * security policy").
 */
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

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

const DEFINE_PROMPT = `تو یک دیکشنریِ انگلیسی‌به‌فارسیِ امروزی و دقیق هستی.
برای «کلمه یا عبارت» انگلیسی که به تو داده می‌شود، فقط و فقط یک آبجکت JSON معتبر برگردان؛ بدون مقدمه، بدون بلوک کد و بدون مارک‌داون.
ساختار دقیق خروجی:
{ "meaning": "معنی فارسی، خیلی کوتاه و روشن (یک خط، حداکثر چند کلمه)" }
قواعد:
- معنی باید دقیقاً همان مفهوم در جمله‌ی داده‌شده باشد، نه فهرست همه‌ی معانی.
- کوتاه و طبیعی بنویس؛ توضیح اضافه، مثال و شماره‌گذاری ممنوع.
- اگر عبارت بود، معادلِ روان فارسی بده نه ترجمه‌ی کلمه‌به‌کلمه.`

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

/**
 * Workers AI chat models return an OpenAI-style payload: the raw text lives in
 * `choices[0].message.content`, while the top-level `response` may already be a parsed object.
 */
function readContent(result: unknown): string {
  const data = result as {
    choices?: Array<{ message?: { content?: unknown } }>
    response?: unknown
  }
  const fromChoices = data?.choices?.[0]?.message?.content
  if (typeof fromChoices === 'string' && fromChoices.trim()) return fromChoices
  const raw = data?.response
  if (typeof raw === 'string' && raw.trim()) return raw
  if (raw && typeof raw === 'object') return JSON.stringify(raw)
  throw new Error(`Unexpected Workers AI response: ${JSON.stringify(result).slice(0, 300)}`)
}

/** Single AI entry point: run a chat completion on the Workers AI binding. */
async function chat(env: Env, system: string, user: string, temperature: number): Promise<string> {
  if (!env.AI) {
    throw new Error('The Workers AI binding (AI) is not configured. Add the [ai] block to wrangler.toml.')
  }
  const ai = env.AI as unknown as {
    run: (model: string, inputs: unknown) => Promise<unknown>
  }
  const result = await ai.run(WORKERS_AI_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: 1024,
  })
  return readContent(result)
}

/** Ask the model for a Persian explanation of a single English sentence. */
export async function explainSentence(
  env: Env,
  sentence: string,
  lessonTitle?: string,
): Promise<ExplanationFa> {
  const userPrompt = lessonTitle
    ? `عنوان درس: ${lessonTitle}\nجمله: ${sentence}`
    : `جمله: ${sentence}`

  const content = await chat(env, SYSTEM_PROMPT, userPrompt, 0.2)
  return coerce(extractJson(content))
}

/** Ask the model for a one-line Persian meaning of a single word/phrase in context. */
export async function defineWord(
  env: Env,
  word: string,
  contextSentence: string,
): Promise<string> {
  const userPrompt = contextSentence
    ? `کلمه/عبارت: ${word}\nجمله: ${contextSentence}`
    : `کلمه/عبارت: ${word}`

  const content = await chat(env, DEFINE_PROMPT, userPrompt, 0.1)
  const data = extractJson(content) as Record<string, unknown>
  const meaning = typeof data?.meaning === 'string' ? data.meaning.trim() : ''
  if (!meaning) throw new Error('Missing "meaning" in model response')
  return meaning
}