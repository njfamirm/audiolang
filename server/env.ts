/**
 * Cloudflare Worker bindings.
 * Secrets are provided by `.dev.vars` locally and `wrangler secret put` in production.
 */
export type Env = {
  STORE_KV: KVNamespace
  /** Optional R2 bucket holding frozen lesson MP3s (`lessons/${id}.mp3`). */
  AUDIO_BUCKET?: R2Bucket
  ASSETS: Fetcher
  /** Workers AI binding — used for Whisper speech-to-text and chat explanations. */
  AI: Ai
  /** OpenRouter key — fallback chat provider when Workers AI is quota-limited. */
  OPENROUTER_API_KEY?: string
  /** OpenRouter chat model id. Defaults to `deepseek/deepseek-chat`. */
  OPENROUTER_MODEL?: string
  /** Override for the OpenRouter chat completions endpoint. */
  OPENROUTER_BASE_URL?: string
  /** Audio-capable OpenRouter model used when Workers AI Whisper is unavailable. */
  OPENROUTER_TRANSCRIBE_MODEL?: string
  /**
   * Groq API key. When set, transcription runs on Groq `whisper-large-v3-turbo` first because
   * it returns precise word- and segment-level timestamps (OpenAI verbose_json).
   */
  GROQ_API_KEY?: string
  /** Groq chat model id used as the text-AI fallback. Defaults to `openai/gpt-oss-120b`. */
  GROQ_MODEL?: string
  /**
   * Shared passcode(s) that gate every write/read API route.
   * Accepts a single code or a comma-separated list so access can be shared with a few friends,
   * e.g. "secret123" or "pass1,pass2,pass3". Unset = auth disabled (local dev only).
   */
  APP_PASSCODE?: string
  /** Optional secret used to sign session tokens. Falls back to APP_PASSCODE when unset. */
  AUTH_SECRET?: string
}
