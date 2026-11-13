import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { AdminUserDeleteState, UserDeletePhase } from '@photox/shared-types';

/**
 * Durable progress of one account wipe, keyed by the userId being deleted (there is only ever
 * one run per account, and the user row disappears at the end, so no FK).
 *
 * The wipe is batched across many HTTP calls (worker drives, core owns the DB), so progress
 * cannot live in memory: a core restart mid-wipe must not lose the phase, and the admin status
 * poll must keep answering after the user row is gone. Small rows, kept forever — they also tell
 * a `partial` run apart from a clean one.
 */
@Entity('user_deletes')
export class UserDelete {
  @PrimaryColumn('uuid')
  userId!: string;

  @Column({ type: 'varchar', length: 64 })
  jobId!: string;

  /** The account's email at wipe time: the user row is gone by the time this is read. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 16 })
  state!: AdminUserDeleteState;

  @Column({ type: 'varchar', length: 512, default: '' })
  backupPrefix!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  phase!: UserDeletePhase | null;

  @Column({ type: 'int', default: 0 })
  deletedRows!: number;

  @Column({ type: 'int', default: 0 })
  deletedFiles!: number;

  @Column({ type: 'int', default: 0 })
  failedFiles!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** Sessions are killed once, on the first step, so the account is locked while rows drain. */
  @Column({ type: 'boolean', default: false })
  sessionsLocked!: boolean;

  // plain columns, not Create/UpdateDateColumn: a retry's upsert resets the counters and must
  // keep the first attempt's start time
  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
