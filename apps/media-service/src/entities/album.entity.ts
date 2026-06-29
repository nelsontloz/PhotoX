import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm'
import { AlbumAsset } from './album-asset.entity'

@Entity('albums')
export class Album {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  @Index()
  userId!: string

  @Column({ type: 'varchar', length: 255 })
  name!: string

  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date

  @OneToMany(() => AlbumAsset, (aa) => aa.album)
  assets?: AlbumAsset[]
}
