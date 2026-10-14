import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  userId!: string

  @Column({ unique: true })
  tokenHash!: string

  @Column({ type: 'timestamptz' })
  @Index()
  expiresAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  absoluteExpiresAt!: Date | null

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date
}
