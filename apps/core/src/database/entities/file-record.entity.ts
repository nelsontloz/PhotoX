import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

@Entity('files')
@Index(['userId', 'checksumSha256'])
@Index(['userId', 'purpose', 'createdAt'])
// P1-5 upload double-create race arbiter: concurrent uploads of identical bytes both pass
// the findOne fast path, so the insert (ON CONFLICT DO NOTHING + re-read winner) decides.
// Partial to originals only — transcodes legitimately share checksums across assets.
// NOTE: @Unique can't express the WHERE predicate; this @Index(where) is the equivalent.
@Index('files_user_checksum_original', ['userId', 'checksumSha256'], {
  unique: true,
  where: "purpose = 'original'",
})
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
