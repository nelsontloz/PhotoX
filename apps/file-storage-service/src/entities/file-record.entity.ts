import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('files')
export class FileRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  userId!: string

  @Column()
  storageKey!: string

  @Column()
  originalName!: string

  @Column()
  mimeType!: string

  @Column({ type: 'bigint' })
  sizeBytes!: number

  @Column()
  checksumSha256!: string

  @Column({ default: 'pending' })
  processingStatus!: string

  @Column({ nullable: true })
  width?: number

  @Column({ nullable: true })
  height?: number

  @Column({ type: 'timestamptz', nullable: true })
  takenAt?: Date

  @CreateDateColumn()
  createdAt!: Date
}
