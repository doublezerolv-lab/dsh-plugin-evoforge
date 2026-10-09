const secretField = /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie|email|phone|address|private[-_]?key)/i
export function redactText(text: string, maxChars = 2048): string {
  return text
    .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?(?:-----END [\w ]*PRIVATE KEY-----|$)/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ds)[-_][a-zA-Z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[-_]?key|password|secret|token|authorization)\s*[=:]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .slice(0, maxChars)
}
export function redact(value: unknown, maxChars = 2048, depth = 0): unknown {
  if (depth > 6) return '[DEPTH_LIMIT]'
  if (typeof value === 'string') return redactText(value, maxChars)
  if (Array.isArray(value)) return value.slice(0, 40).map(item => redact(item, maxChars, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
      redactText(key, 80), secretField.test(key) ? '[REDACTED]' : redact(item, maxChars, depth + 1),
    ]))
  }
  return value
}
