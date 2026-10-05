import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm'
import { Asset } from './asset.entity'

@Entity('asset_detections')
export class AssetDetection {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  @Index()
  assetId!: string

  @ManyToOne(() => Asset, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset

  @Column('text')
  label!: string

  @Column('real')
  confidence!: number

  // original-image pixel coords, same shape as Face.box
  @Column('jsonb')
  box!: { x: number; y: number; w: number; h: number }

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
