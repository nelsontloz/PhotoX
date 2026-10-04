import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm'
import { SEARCH_EMBEDDING_DIM } from '@photox/shared-types'
import { vectorTransformer } from '../shared/pgvector'
import { Asset } from './asset.entity'

// Vision search embeddings (SigLIP2-B/16 → 768-d; SEARCH_EMBEDDING_DIM).
// Stored as text like faces.embedding; the HNSW index casts to halfvec(768).
@Entity('asset_embeddings')
@Unique(['assetId', 'kind', 'model'])
export class AssetEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  assetId!: string

  @ManyToOne(() => Asset, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset

  // 'image' only for now — video_frame can be added when video search lands
  @Column({ type: 'text', default: 'image' })
  kind!: string

  @Column('text')
  model!: string

  @Column({ type: 'text', transformer: vectorTransformer(SEARCH_EMBEDDING_DIM, 'asset embedding') })
  embedding!: number[]
}
