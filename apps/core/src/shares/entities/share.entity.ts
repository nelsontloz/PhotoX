import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm'
import type { ShareKind } from '@photox/shared-types'
import { Asset } from '../../database/entities'
import { Album } from '../../albums/entities/album.entity'

@Entity('shares')
@Check('CHK_shares_exactly_one_target', '("assetId" IS NULL) <> ("albumId" IS NULL)')
@Index(['token'], { unique: true })
@Index(['userId'])
@Index(['assetId', 'userId'], { unique: true, where: '"assetId" IS NOT NULL' })
@Index(['albumId', 'userId'], { unique: true, where: '"albumId" IS NOT NULL' })
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  userId!: string

  @Column({ type: 'varchar', length: 16 })
  kind!: ShareKind

  @Column({ type: 'uuid', nullable: true })
  assetId!: string | null

  @ManyToOne(() => Asset, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset | null

  @Column({ type: 'uuid', nullable: true })
  albumId!: string | null

  @ManyToOne(() => Album, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'albumId' })
  album!: Album | null

  @Column({ type: 'varchar', length: 32 })
  token!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
