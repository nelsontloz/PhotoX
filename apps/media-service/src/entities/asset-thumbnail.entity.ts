import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm'
import { Asset } from './asset.entity'

@Entity('asset_thumbnails')
@Unique(['assetId', 'size'])
export class AssetThumbnail {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  assetId!: string

  @ManyToOne(() => Asset, (a) => a.thumbnails, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset

  @Column({ type: 'text' })
  size!: string

  @Column({ type: 'uuid' })
  fileId!: string

  @Column({ type: 'int' })
  width!: number

  @Column({ type: 'int' })
  height!: number

  @Column({ type: 'bigint' })
  bytes!: number

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
