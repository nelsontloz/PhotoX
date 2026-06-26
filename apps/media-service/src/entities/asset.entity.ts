import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
  OneToMany,
} from 'typeorm'
import { AssetThumbnail } from './asset-thumbnail.entity'

@Entity('assets')
@Index(['userId', 'uploadedAt'])
@Index(['userId', 'takenAt'])
@Index(['userId', 'kind', 'uploadedAt'])
@Index(['userId'], { where: '"isTrashed" = false' })
@Unique(['fileId'])
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  @Index()
  userId!: string

  @Column({ type: 'enum', enum: ['photo', 'video'] })
  @Index()
  kind!: 'photo' | 'video'

  @Column({ type: 'uuid', unique: true })
  fileId!: string

  @CreateDateColumn({ type: 'timestamptz' })
  uploadedAt!: Date

  @Column({ default: false })
  isTrashed!: boolean

  @Column({ type: 'timestamptz', nullable: true })
  trashedAt!: Date | null

  @Column({ type: 'varchar', nullable: true })
  title!: string | null

  @Column({ type: 'varchar', nullable: true })
  description!: string | null

  @Column({ type: 'timestamptz', nullable: true })
  takenAt!: Date | null

  @Column({ default: false })
  favorite!: boolean

  @Column({ type: 'varchar', nullable: true })
  mimeType!: string | null

  @Column({ type: 'bigint', nullable: true })
  sizeBytes!: number | null

  @Column({ type: 'varchar', nullable: true })
  originalName!: string | null

  @Column({ type: 'int', nullable: true })
  width!: number | null

  @Column({ type: 'int', nullable: true })
  height!: number | null

  @Column({ type: 'numeric', nullable: true })
  durationSeconds!: number | null

  @Column({ type: 'varchar', nullable: true })
  cameraMake!: string | null

  @Column({ type: 'varchar', nullable: true })
  cameraModel!: string | null

  @Column({ type: 'varchar', nullable: true })
  lensModel!: string | null

  @Column({ type: 'int', nullable: true })
  orientation!: number | null

  @Column({ type: 'int', nullable: true })
  iso!: number | null

  @Column({ type: 'numeric', precision: 3, scale: 1, nullable: true })
  fNumber!: number | null

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  exposureTime!: number | null

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true })
  focalLength!: number | null

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  latitude!: number | null

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  longitude!: number | null

  @Column({ type: 'numeric', precision: 9, scale: 3, nullable: true })
  altitude!: number | null

  @Column({ type: 'numeric', nullable: true })
  fps!: number | null

  @Column({ type: 'varchar', nullable: true })
  codec!: string | null

  @Column({ type: 'boolean', nullable: true })
  hasAudio!: boolean | null

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null

  @Column({ type: 'enum', enum: ['pending', 'ready', 'failed'], default: 'pending' })
  metadataStatus!: 'pending' | 'ready' | 'failed'

  @Column({ type: 'timestamptz', nullable: true })
  metadataExtractedAt!: Date | null

  @Column({ type: 'text', nullable: true })
  hlsMasterKey!: string | null

  @Column({ type: 'varchar', length: 16, nullable: true })
  transcodeStatus!: 'pending' | 'ready' | 'failed' | null

  @Column({ type: 'varchar', length: 16, nullable: true })
  thumbnailStatus!: 'pending' | 'ready' | 'failed' | null

  @Column({ type: 'timestamptz', nullable: true })
  transcodedAt!: Date | null

  @OneToMany(() => AssetThumbnail, (t) => t.asset)
  thumbnails?: AssetThumbnail[]
}
