import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('photos')
export class Photo {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  userId!: string

  @Column()
  fileId!: string

  @Column({ nullable: true })
  title?: string

  @Column({ nullable: true })
  description?: string

  @Column({ type: 'timestamptz', nullable: true })
  takenAt?: Date

  @CreateDateColumn()
  uploadedAt!: Date

  @Column({ default: false })
  isTrashed!: boolean

  @Column({ type: 'timestamptz', nullable: true })
  trashedAt?: Date

  @Column({ nullable: true })
  width?: number

  @Column({ nullable: true })
  height?: number
}
