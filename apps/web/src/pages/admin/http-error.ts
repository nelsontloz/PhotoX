import { isAxiosError } from 'axios'

/** The core's own message (validation arrays joined), split for matching vs display. */
export interface ErrorDetail {
  /** As sent, joined when the core answers with an array. */
  text: string
  /** Lowercased copy, for stable substring matching. */
  lower: string
}

export type StatusMessage = string | ((detail: ErrorDetail) => string)

export interface HttpErrorMessages {
  /** Sentence used when no case matches. */
  fallback: string
  /** Per-status sentence, optionally built from the core's message. */
  byStatus?: Partial<Record<number, StatusMessage>>
  /** 503 / unreachable backup store sentence (checked before `byStatus`). */
  offline?: string
  /** No response / ECONNABORTED sentence (checked before `byStatus`). */
  timeout?: string
  /** Prefer the core's own message (trimmed) before `fallback`. */
  serverDetail?: boolean
  /** Prefer the raw Error.message before `fallback` (otherwise the sentence stays plain). */
  rawMessage?: boolean
}

function detailOf(err: unknown): ErrorDetail {
  if (!isAxiosError(err)) return { text: '', lower: '' }
  const body = err.response?.data as { message?: unknown } | undefined
  const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message
  const text = typeof message === 'string' ? message : ''
  return { text, lower: text.toLowerCase() }
}

/**
 * The admin console's one axios-status → sentence mapper: maps a failure to the caller's
 * per-case copy so no raw axios text ever reaches the UI.
 */
export function httpErrorMessage(err: unknown, messages: HttpErrorMessages): string {
  const { fallback, byStatus, offline, timeout, serverDetail, rawMessage } = messages
  const detail = detailOf(err)
  if (isAxiosError(err)) {
    const status = err.response?.status
    if (status === 503 && offline) return offline
    if ((!err.response || err.code === 'ECONNABORTED') && timeout) return timeout
    if (status !== undefined && byStatus?.[status] !== undefined) {
      const mapped = byStatus[status]
      return typeof mapped === 'function' ? mapped(detail) : mapped
    }
    if (serverDetail) {
      const text = detail.text.trim()
      if (text !== '') return text
    }
  }
  if (rawMessage && err instanceof Error && err.message) return err.message
  return fallback
}
