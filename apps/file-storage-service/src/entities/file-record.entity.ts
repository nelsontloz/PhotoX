import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('files')
export class FileRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column()
  userId!: string

  @Column()
  storageKey!: string

  @Column()
  originalName!: string

  @Column()
  mimeType!: string

  @Column({ type: 'bigint' })
  sizeBytes!: number

  @Column()
  checksumSha256!: string

  @CreateDateColumn()
  createdAt!: Date
}
