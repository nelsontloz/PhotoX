import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export enum JobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('job_records')
export class JobRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  assetId!: string

  @Column()
  fileId!: string

  @Column()
  size!: string

  @Column({ type: 'varchar', length: 20, default: JobStatus.QUEUED })
  status!: string

  @Column({ type: 'text', nullable: true })
  error?: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
