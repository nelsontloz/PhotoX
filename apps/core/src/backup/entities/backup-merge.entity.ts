import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

// Durable ledger for legacy-snapshot merges: one row per (backup source account,
// live target account). Written only after the source snapshot is adopted into
// the live prefix (bytes copied, manifests unioned); the row is then what makes
// a second plain merge a 409. `prefix` stays the source prefix for audit even
// though adoption deletes its objects; a failed adoption writes no row, so a
// plain retry remains allowed, while force replays the row-ledger recovery path.
@Entity('backup_merges')
@Unique(['backupUserId', 'targetUserId'])
@Index(['targetUserId'])
export class BackupMerge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  backupUserId!: string;

  @Column('uuid')
  targetUserId!: string;

  @Column('text')
  prefix!: string;

  @Column({ type: 'jsonb', default: {} })
  counts!: Record<string, number>;

  @CreateDateColumn({ type: 'timestamptz' })
  mergedAt!: Date;
}
