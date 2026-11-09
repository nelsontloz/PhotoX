import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type BackupRunKind = 'backup' | 'restore';
export type BackupRunState =
  'running' | 'paused' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

// One row per admin backup/restore start. The transfer itself is a ledger of per-file
// `backup_run_items` rows claimed by the advisory-locked sweeper, so a run survives a core
// restart and every file retries on its own (see UserBackupService.runTransfersOnce).
@Entity('backup_runs')
@Index(['userId', 'startedAt'])
export class BackupRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  kind!: BackupRunKind;

  @Column('uuid')
  userId!: string;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  state!: BackupRunState;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  // current (backup) or source (restore) S3 prefix
  @Column({ type: 'text', nullable: true })
  prefix!: string | null;

  @Column({ type: 'text', nullable: true })
  manifestKey!: string | null;

  // relative STORAGE_DIR key of the draft/restore manifest, e.g. backup-runs/<id>/manifest.json
  @Column({ type: 'text', nullable: true })
  manifestPath!: string | null;

  // manifest identity (`backedUpAt`), used to decide whether a same-id restore may resume
  @Column({ type: 'text', nullable: true })
  identity!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  stalePrefixes!: string[];

  // restore only: assets this run trashed because their bytes were missing (a resumed run
  // un-trashes the ones that downloaded this time)
  @Column({ type: 'jsonb', default: () => "'[]'" })
  brokenFileIds!: string[];

  @Column({ type: 'jsonb', default: () => "'{}'" })
  counts!: Record<string, number>;

  @Column({ type: 'int', default: 0 })
  totalItems!: number;

  // done or permanently failed; progress = completedItems / totalItems
  @Column({ type: 'int', default: 0 })
  completedItems!: number;

  @Column({ type: 'int', default: 0 })
  uploaded!: number;

  @Column({ type: 'int', default: 0 })
  skipped!: number;

  @Column({ type: 'int', default: 0 })
  failedItems!: number;

  @Column({ type: 'text', nullable: true })
  currentFile!: string | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;
}
