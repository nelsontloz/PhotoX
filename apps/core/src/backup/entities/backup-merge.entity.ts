import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm'

// Durable ledger for legacy-snapshot merges: one row per (backup source account,
// live target account). The S3 backup stays untouched so a merge is replayable
// with force after a partial run; the unique pair is what turns a second plain
// merge into a 409 instead of silently duplicating rows.
@Entity('backup_merges')
@Unique(['backupUserId', 'targetUserId'])
@Index(['targetUserId'])
export class BackupMerge {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  backupUserId!: string

  @Column('uuid')
  targetUserId!: string

  @Column('text')
  prefix!: string

  @Column({ type: 'jsonb', default: {} })
  counts!: Record<string, number>

  @CreateDateColumn({ type: 'timestamptz' })
  mergedAt!: Date
}
