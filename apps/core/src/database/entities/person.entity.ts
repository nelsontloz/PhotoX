import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('persons')
@Index(['userId', 'clusterLabel'])
@Index(['userId', 'faceCount'])
export class Person {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  userId!: string;

  @Column('text', { nullable: true })
  name!: string | null;

  @Column('uuid', { nullable: true })
  coverFaceId!: string | null;

  @Column('text', { nullable: true })
  clusterLabel!: string | null;

  @Column('int', { default: 0 })
  faceCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
