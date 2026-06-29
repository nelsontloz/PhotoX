import { Entity, PrimaryColumn, CreateDateColumn, Index } from 'typeorm'

@Entity('album_assets')
export class AlbumAsset {
  @PrimaryColumn('uuid')
  albumId!: string

  @PrimaryColumn('uuid')
  @Index()
  assetId!: string

  @CreateDateColumn({ type: 'timestamptz' })
  addedAt!: Date
}
