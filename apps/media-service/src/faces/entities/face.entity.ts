import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'
import { toSql as pgToSql, fromSql as pgFromSql } from 'pgvector'

const toVectorString = (v: number[]): string => pgToSql(v) as string
const fromVectorString = (v: string): number[] => pgFromSql(v) as number[]

@Entity('faces')
export class Face {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  assetId!: string

  @Column('uuid')
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
