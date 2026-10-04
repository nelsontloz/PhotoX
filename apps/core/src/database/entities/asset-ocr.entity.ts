import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm'
import { Asset } from './asset.entity'

@Entity('asset_ocr')
export class AssetOcr {
  @PrimaryColumn('uuid')
  assetId!: string

  @ManyToOne(() => Asset, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset

  @Column('text')
  text!: string

  @Column({ type: 'text', nullable: true })
  lang!: string | null

  @Column({ type: 'real', nullable: true })
  confidence!: number | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
