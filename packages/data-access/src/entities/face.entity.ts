import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'
import { toSql as pgToSql, fromSql as pgFromSql } from 'pgvector'

// ponytail: single source of truth for the embedding dim (InsightFace buffalo_l w600k_r50) —
// detector output, DTO validation, cluster filters, and the HNSW index cast all reference this
export const FACE_EMBEDDING_DIM = 512

const toVectorString = (v: number[]): string => pgToSql(v) as string
const fromVectorString = (v: string): number[] => pgFromSql(v) as number[]

@Entity('faces')
@Index(['personId', 'userId'])
export class Face {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  @Index()
  assetId!: string

  @Column('uuid')
  @Index()
  userId!: string

  @Column('jsonb')
  box!: { x: number; y: number; w: number; h: number }

  @Column('real')
  confidence!: number

  @Column({
    type: 'text',
    transformer: {
      to: toVectorString,
      from: fromVectorString,
    },
  })
  embedding!: number[]

  // ponytail: plain uuid column, no TypeORM relation — avoids circular import between faces/ and persons/ modules
  @Column('uuid', { nullable: true })
  @Index()
  personId!: string | null

  @CreateDateColumn()
  createdAt!: Date
}
