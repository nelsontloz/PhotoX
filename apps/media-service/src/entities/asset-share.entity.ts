import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm'
import { Asset } from './asset.entity'

@Entity('asset_shares')
@Index(['token'], { unique: true })
@Index(['userId'])
export class AssetShare {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  assetId!: string

  @ManyToOne(() => Asset, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset

  @Column()
  userId!: string

  @Column({ type: 'varchar', length: 32 })
  token!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
