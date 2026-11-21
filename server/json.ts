/**
 * Models sometimes wrap JSON in prose or markdown fences.
 * Pull the first valid JSON object out of the response.
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw new Error('Model did not return valid JSON')
  }
}