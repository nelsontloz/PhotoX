import { loadEnv } from './env'

export interface BackupPrefixParams {
  email: string
  userId: string
  prefix?: string
}

export type ManifestKeyParams = BackupPrefixParams

export interface OriginalKeyParams extends BackupPrefixParams {
  fileId: string
  ext: string
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment)
}

function requireNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) throw new Error(`Invalid backup ${name}: must not be empty`)
  return value
}

function normalizePrefixSegments(prefix: string): string {
  const encoded = prefix
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeSegment(segment))
    .join('/')
  return encoded
}

export function resolveBackupPrefix(prefix?: string): string {
  const raw = prefix ?? loadEnv().S3_BACKUP_PREFIX
  const cleaned = normalizePrefixSegments(raw)
  return cleaned.length > 0 ? `${cleaned}/` : ''
}

function resolvePrefixArg(prefix?: string): string {
  return resolveBackupPrefix(prefix)
}

export function backupPrefix(email: string, userId: string, prefix?: string): string
export function backupPrefix(params: BackupPrefixParams): string
export function backupPrefix(
  emailOrParams: string | BackupPrefixParams,
  userId?: string,
  prefix?: string,
): string {
  const email = typeof emailOrParams === 'string' ? emailOrParams : emailOrParams.email
  const resolvedUserId = typeof emailOrParams === 'string' ? userId! : emailOrParams.userId
  const resolvedPrefix = typeof emailOrParams === 'string' ? prefix : emailOrParams.prefix
  const normalized = normalizeEmail(requireNonEmpty(email, 'email'))
  requireNonEmpty(resolvedUserId, 'userId')
  const base = resolvePrefixArg(resolvedPrefix)
  return `${base}${encodeSegment(normalized)}__${encodeSegment(resolvedUserId)}/`
}

export function manifestKey(email: string, userId: string, prefix?: string): string
export function manifestKey(params: ManifestKeyParams): string
export function manifestKey(
  emailOrParams: string | ManifestKeyParams,
  userId?: string,
  prefix?: string,
): string {
  const prefixPart =
    typeof emailOrParams === 'string'
      ? backupPrefix(emailOrParams, userId!, prefix)
      : backupPrefix(emailOrParams)
  return `${prefixPart}manifest.json`
}

export function originalKey(
  email: string,
  userId: string,
  fileId: string,
  ext: string,
  prefix?: string,
): string
export function originalKey(params: OriginalKeyParams): string
export function originalKey(
  emailOrParams: string | OriginalKeyParams,
  userId?: string,
  fileId?: string,
  ext?: string,
  prefix?: string,
): string {
  if (typeof emailOrParams !== 'string') {
    const base = backupPrefix(emailOrParams)
    requireNonEmpty(emailOrParams.fileId, 'fileId')
    return joinOriginalKey(base, emailOrParams.fileId, emailOrParams.ext)
  }
  requireNonEmpty(fileId!, 'fileId')
  return joinOriginalKey(backupPrefix(emailOrParams, userId!, prefix), fileId!, ext!)
}

function joinOriginalKey(base: string, fileId: string, ext: string): string {
  const cleanExt = ext.replace(/^\.+/, '')
  const name =
    cleanExt.length > 0
      ? `${encodeSegment(fileId)}.${encodeSegment(cleanExt)}`
      : encodeSegment(fileId)
  return `${base}originals/${name}`
}

/**
 * Inverse of the `<email>__<userId>` folder segment built by {@link backupPrefix}.
 * Splits on the LAST `__` — emails may contain `__` while UUIDs never contain `_`,
 * so the userId is always the tail. Both segments are `decodeURIComponent`-decoded.
 * Throws on a missing separator or an empty side.
 */
export function parseBackupDir(dir: string): { email: string; userId: string } {
  const folder = dir.replace(/\/+$/, '')
  const sep = folder.lastIndexOf('__')
  if (sep < 0) throw new Error(`Invalid backup folder: missing __ separator: ${dir}`)
  const email = decodeURIComponent(folder.slice(0, sep))
  const userId = decodeURIComponent(folder.slice(sep + 2))
  requireNonEmpty(email, 'email')
  requireNonEmpty(userId, 'userId')
  return { email, userId }
}
