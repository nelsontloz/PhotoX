import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type BackupRunItemState =
  'pending' | 'retrying' | 'queued' | 'running' | 'failed' | 'missing';

// Work row for one original: upload it (backup) or download it (restore). Successful rows are
// deleted, so the table only ever holds outstanding or failed work — an empty run is finished.
@Entity('backup_run_items')
@Unique(['runId', 'fileId'])
@Index(['runId', 'state', 'nextAttemptAt'])
// the dispatcher claims due work ACROSS runs every ~1s (state IN (...) AND nextAttemptAt <= now(),
// ordered by nextAttemptAt), which the runId-leading index cannot serve
@Index('idx_backup_run_items_state_next_attempt', ['state', 'nextAttemptAt'])
export class BackupRunItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  runId!: string;

  @Column('uuid')
  fileId!: string;

  // local destination/source key under STORAGE_DIR
  @Column({ type: 'text' })
  storageKey!: string;

  // S3 object key (backup destination, restore source)
  @Column({ type: 'text' })
  s3Key!: string;

  @Column({ type: 'bigint' })
  sizeBytes!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  checksumSha256!: string | null;

  @Column({ type: 'text', nullable: true })
  mimeType!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  state!: BackupRunItemState;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
