import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'
import { vectorTransformer } from '../shared/pgvector'
import type { FaceDetectorKind } from '@photox/shared-types'

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

  @Column({ type: 'text', transformer: vectorTransformer() })
  embedding!: number[]

  // ponytail: plain uuid column, no TypeORM relation — avoids circular import between faces/ and persons/ modules
  @Column('uuid', { nullable: true })
  personId!: string | null

  // provenance: which detector produced this embedding; null on pre-provenance rows (unknown origin)
  @Column('text', { nullable: true })
  detector!: FaceDetectorKind | null

  @CreateDateColumn()
  createdAt!: Date
}
