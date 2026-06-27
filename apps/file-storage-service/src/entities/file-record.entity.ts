import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

@Entity('files')
@Index(['userId', 'checksumSha256'])
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

  @Column({ type: 'varchar', length: 16, default: 'original' })
  purpose!: 'original' | 'transcode'

  @Column({ type: 'uuid', nullable: true })
  @Index()
  assetId!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
