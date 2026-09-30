import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

@Entity('persons')
@Index(['userId', 'clusterLabel'])
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column('uuid')
  @Index()
  userId!: string

  @Column('text', { nullable: true })
  name!: string | null

  @Column('uuid', { nullable: true })
  coverFaceId!: string | null

  @Column('text', { nullable: true })
  clusterLabel!: string | null

  @Column('int', { default: 0 })
  faceCount!: number

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
