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

  @Column({ nullable: true })
  title!: string | null

  @Column({ nullable: true })
  description!: string | null

  @Column({ type: 'timestamptz', nullable: true })
  takenAt!: Date | null

  @Column({ default: false })
  favorite!: boolean

  @Column({ nullable: true })
  mimeType!: string | null

  @Column({ type: 'bigint', nullable: true })
  sizeBytes!: number | null

  @Column({ nullable: true })
  originalName!: string | null

  @Column({ nullable: true })
  width!: number | null

  @Column({ nullable: true })
  height!: number | null

  @Column({ type: 'numeric', nullable: true })
  durationSeconds!: number | null

  @Column({ nullable: true })
  cameraMake!: string | null

  @Column({ nullable: true })
  cameraModel!: string | null

  @Column({ nullable: true })
  orientation!: number | null

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  latitude!: number | null

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  longitude!: number | null

  @Column({ type: 'numeric', nullable: true })
  fps!: number | null

  @Column({ nullable: true })
  codec!: string | null

  @Column({ nullable: true })
  hasAudio!: boolean | null

  @Column({ type: 'enum', enum: ['pending', 'ready', 'failed'], default: 'pending' })
  metadataStatus!: 'pending' | 'ready' | 'failed'

  @Column({ type: 'timestamptz', nullable: true })
  metadataExtractedAt!: Date | null

  @OneToMany(() => AssetThumbnail, (t) => t.asset)
  thumbnails?: AssetThumbnail[]
}
