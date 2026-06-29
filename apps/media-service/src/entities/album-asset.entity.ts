import { Entity, PrimaryColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm'
import { Album } from './album.entity'
import { Asset } from './asset.entity'

@Entity('album_assets')
export class AlbumAsset {
  @PrimaryColumn('uuid')
  albumId!: string

  @ManyToOne(() => Album, (a) => a.assets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'albumId' })
  album!: Album

  @PrimaryColumn('uuid')
  @Index()
  assetId!: string

  @ManyToOne(() => Asset, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset

  @CreateDateColumn({ type: 'timestamptz' })
  addedAt!: Date
}
