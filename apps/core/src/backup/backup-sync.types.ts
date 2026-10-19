/**
 * Outcome of relocating a user's backup after an account edit.
 * `synced` means the backup now matches the live account; `moved` means the
 * S3 prefix itself was relocated to the new address.
 *
 * A `synced: false` result is either benign or a failure — never collapse the
 * two: `reason: 'no-backup'` is the genuine "nothing was ever backed up" case,
 * while `error` reports a real problem (stale-prefix scan/listing outage,
 * unreadable manifest, copy or HEAD-verify failure, unusable prefix).
 */
export interface BackupSyncResult {
  synced: boolean
  moved: boolean
  /** the previous (stale) prefix, when one was relocated */
  from?: string
  /** the prefix derived from the user's CURRENT email ('' when it cannot be computed) */
  to: string
  /** why nothing was synced: no stale prefix AND no manifest at the current prefix */
  reason?: 'no-backup'
  /** failure detail when the sync failed */
  error?: string
}
