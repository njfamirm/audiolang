import type { Env } from './env'
import { extractJson } from './json'
import type { AiPack, ExplanationFa, QuizItem, WarmupItem } from './store'

/**
 * Text AI (Persian explanations, word definitions, lesson packs, output review) runs on the
 * Workers AI binding (`AI`) first. When Workers AI is unavailable — daily neuron/rate limit,
 * 429, error 3040, malformed response, or a missing binding — every text task falls back to
 * Groq (`GROQ_API_KEY`), which is reachable from Workers egress. OpenRouter is kept as a last
 * resort only: its edge WAF often blocks Cloudflare Workers egress with a 403, so it is not a
 * reliable primary fallback. All providers return the same OpenAI-style
 * `choices[0].message.content` payload, so the strict JSON contract is identical.
 */
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_CHAT_DEFAULT_MODEL = 'openai/gpt-oss-120b'

const OPENROUTER_DEFAULT_MODEL = 'deepseek/deepseek-chat'
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions'

const SYSTEM_PROMPT = `تو یک مترجم و معلمِ زبانِ انگلیسیِ حرفه‌ای هستی که فارسی را مثل یک فارسی‌زبانِ بومی و امروزی حرف می‌زند.
برای جمله‌ی انگلیسی که به تو داده می‌شود، فقط و فقط یک آبجکت JSON معتبر برگردان؛ بدون مقدمه، بدون توضیح اضافه، بدون بلوک کد و بدون مارک‌داون.
ساختار دقیق خروجی:
{
  "meaning": "ترجمه‌ی روان و طبیعی فارسی",
  "grammar": "توضیح خیلی کوتاه گرامر یا ساختار جمله به فارسی",
  "idioms": ["اصطلاح یا لغت کلیدی: معنی فارسی"],
  "simpleEnglish": "A simpler A2/B1 English version of this sentence"
}
قواعد:
- «meaning» باید طوری باشد که یک فارسی‌زبانِ بومی همان را در گفت‌وگو می‌گفت؛ ترجمه‌ی کلمه‌به‌کلمه و کتابی ممنوع.
- «simpleEnglish» همان معنی جمله را با انگلیسیِ ساده و در سطح A2/B1 بازنویسی می‌کند؛ کوتاه، طبیعی و بدون اصطلاحِ پیچیده.
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

const PACK_PROMPT = `تو یک معلمِ زبانِ انگلیسی و طراحِ محتوای آموزشی هستی.
متنِ یک اپیزودِ پادکست به تو داده می‌شود؛ فقط و فقط یک آبجکت JSON معتبر برگردان؛ بدون مقدمه، بدون توضیح اضافه، بدون بلوک کد و بدون مارک‌داون.
ساختار دقیق خروجی:
{
  "cefrLevel": "B1+",
  "topic": "2-3 word English topic",
  "warmup": [{ "phrase": "english phrase", "meaningFa": "معنی کوتاه فارسی" }],
  "quiz": [{ "question": "English comprehension question", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanationFa": "توضیح کوتاه فارسی" }],
  "outputPrompt": "A 1-sentence engaging English question about this episode for the learner to answer in 1-2 sentences."
}
قواعد:
- «warmup» دقیقاً ۵ مورد: عبارت‌های کلیدیِ انگلیسیِ اپیزود به همراه معنیِ کوتاه و روان فارسی.
- «quiz» دقیقاً ۳ سؤال درک مطلبِ انگلیسی؛ هر سؤال ۴ گزینه و «correctIndex» از ۰ تا ۳؛ توضیح فارسی کوتاه.
- «cefrLevel» یکی از A2، B1، B1+، B2، C1 باشد.
- «topic» فقط ۲ تا ۳ کلمه انگلیسی.
- «outputPrompt» یک سؤالِ انگلیسیِ جذاب درباره‌ی همین اپیزود که زبان‌آموز در ۱ تا ۲ جمله جواب بدهد.
- خروجی صرفاً JSON باشد.`

const REVIEW_PROMPT = `تو یک معلمِ زبانِ انگلیسیِ حرفه‌ای هستی.
به زبان‌آموز یک سؤال داده شده و او در ۱ تا ۲ جمله جواب نوشته است. فقط و فقط یک آبجکت JSON معتبر برگردان؛ بدون مقدمه، بدون بلوک کد و بدون مارک‌داون.
ساختار دقیق خروجی:
{ "nativeVersion": "Natural, idiomatic English rewrite", "feedbackFa": "توضیح کوتاه و کاربردی فارسی در ۲ جمله درباره نقاط قابل بهبود" }
قواعد:
- «nativeVersion» نوشته‌ی زبان‌آموز را به انگلیسیِ طبیعی و بومی بازنویسی می‌کند، هم‌معنا با نوشته‌ی او.
- «feedbackFa» فقط ۲ جمله‌ی کوتاه فارسی: یک نکته‌ی خوب و یک پیشنهادِ مشخص برای بهتر شدن.
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
  const simpleEnglish = typeof data.simpleEnglish === 'string' ? data.simpleEnglish.trim() : ''
  if (!meaning) throw new Error('Missing "meaning" in model response')
  const result: ExplanationFa = { meaning, grammar: grammar || '—', idioms }
  if (simpleEnglish) result.simpleEnglish = simpleEnglish
  return result
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

/** Run one chat completion on the Cloudflare Workers AI binding. */
async function workersChat(
  env: Env,
  system: string,
  user: string,
  temperature: number,
): Promise<string> {
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

/** Run one chat completion on Groq (OpenAI-compatible, reachable from Workers egress). */
async function groqChat(
  env: Env,
  system: string,
  user: string,
  temperature: number,
): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new Error('Groq is not configured. Set the GROQ_API_KEY secret.')
  }
  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL || GROQ_CHAT_DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: 2048,
      // gpt-oss is a reasoning model: keep the JSON contract and cap the thinking budget.
      response_format: { type: 'json_object' },
      reasoning_effort: 'low',
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Groq request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }
  const data = (await response.json()) as unknown
  return readContent(data)
}

/** Run one chat completion on OpenRouter (OpenAI-compatible chat completions). */
async function openRouterChat(
  env: Env,
  system: string,
  user: string,
  temperature: number,
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter is not configured. Set the OPENROUTER_API_KEY secret.')
  }
  const endpoint = env.OPENROUTER_BASE_URL || OPENROUTER_DEFAULT_BASE_URL
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: 1024,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `OpenRouter request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }
  const data = (await response.json()) as unknown
  return readContent(data)
}

/**
 * Single AI entry point. Order: Workers AI → Groq (reliable from Workers) → OpenRouter (last
 * resort; its WAF may 403 Cloudflare egress). Any provider failure moves to the next one.
 */
async function chat(env: Env, system: string, user: string, temperature: number): Promise<string> {
  let lastError: unknown = null

  if (env.AI) {
    try {
      return await workersChat(env, system, user, temperature)
    } catch (error) {
      lastError = error
      console.error('[ai] Workers AI failed — trying Groq:', error)
    }
  }

  if (env.GROQ_API_KEY) {
    try {
      return await groqChat(env, system, user, temperature)
    } catch (error) {
      lastError = error
      console.error('[ai] Groq failed — trying OpenRouter:', error)
    }
  }

  if (env.OPENROUTER_API_KEY) {
    return openRouterChat(env, system, user, temperature)
  }

  if (!env.AI && !env.GROQ_API_KEY) {
    throw new Error(
      'No AI provider configured. Add the Workers AI [ai] binding or set GROQ_API_KEY.',
    )
  }
  throw new Error(lastError instanceof Error ? lastError.message : 'AI request failed')
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

/** The generated lesson pack plus the metadata kept directly on the lesson. */
export interface GeneratedLessonPack extends AiPack {
  cefrLevel: string
  topic: string
}

function coercePack(value: unknown): GeneratedLessonPack {
  if (typeof value !== 'object' || value === null) throw new Error('Malformed lesson pack payload')
  const data = value as Record<string, unknown>

  const cefrLevel =
    typeof data.cefrLevel === 'string' && data.cefrLevel.trim() ? data.cefrLevel.trim() : 'B1'
  const topic = typeof data.topic === 'string' ? data.topic.trim() : ''

  const warmup: WarmupItem[] = Array.isArray(data.warmup)
    ? data.warmup.flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return []
        const item = raw as Record<string, unknown>
        const phrase = typeof item.phrase === 'string' ? item.phrase.trim() : ''
        const meaningFa = typeof item.meaningFa === 'string' ? item.meaningFa.trim() : ''
        if (!phrase || !meaningFa) return []
        const entry: WarmupItem = { phrase, meaningFa }
        if (typeof item.note === 'string' && item.note.trim()) entry.note = item.note.trim()
        return [entry]
      })
    : []

  const quiz: QuizItem[] = Array.isArray(data.quiz)
    ? data.quiz.flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return []
        const item = raw as Record<string, unknown>
        const question = typeof item.question === 'string' ? item.question.trim() : ''
        const options = Array.isArray(item.options)
          ? item.options
              .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
              .map((option) => option.trim())
          : []
        if (!question || options.length < 2) return []
        const rawIndex = typeof item.correctIndex === 'number' ? Math.trunc(item.correctIndex) : 0
        const correctIndex = Math.min(Math.max(rawIndex, 0), options.length - 1)
        const explanationFa = typeof item.explanationFa === 'string' ? item.explanationFa.trim() : ''
        return [{ question, options, correctIndex, explanationFa }]
      })
    : []

  const outputPrompt = typeof data.outputPrompt === 'string' ? data.outputPrompt.trim() : ''
  if (warmup.length === 0 && quiz.length === 0 && !outputPrompt) {
    throw new Error('Empty lesson pack in model response')
  }
  return { cefrLevel, topic, warmup, quiz, outputPrompt }
}

/** Generate a warm-up + comprehension quiz + output prompt pack from a lesson transcript. */
export async function generateLessonPack(
  env: Env,
  title: string,
  transcriptText: string,
): Promise<GeneratedLessonPack> {
  // Keep tokens low: only the first ~6000 characters of the transcript are sent.
  const excerpt = transcriptText.slice(0, 6000)
  const userPrompt = `عنوان: ${title}\nمتن اپیزود:\n${excerpt}`
  const content = await chat(env, PACK_PROMPT, userPrompt, 0.4)
  return coercePack(extractJson(content))
}

/** Review the learner's written answer and return a native rewrite + short Persian feedback. */
export async function reviewOutput(
  env: Env,
  lessonTitle: string,
  prompt: string,
  userText: string,
): Promise<{ nativeVersion: string; feedbackFa: string }> {
  const userPrompt = `عنوان درس: ${lessonTitle}\nسؤال: ${prompt}\nپاسخ زبان‌آموز: ${userText}`
  const content = await chat(env, REVIEW_PROMPT, userPrompt, 0.3)
  const data = extractJson(content) as Record<string, unknown>
  const nativeVersion = typeof data?.nativeVersion === 'string' ? data.nativeVersion.trim() : ''
  const feedbackFa = typeof data?.feedbackFa === 'string' ? data.feedbackFa.trim() : ''
  if (!nativeVersion && !feedbackFa) throw new Error('Missing output feedback in model response')
  return { nativeVersion, feedbackFa }
}
