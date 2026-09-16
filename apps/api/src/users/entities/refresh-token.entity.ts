import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'uuid' })
  userId!: string

  @Column({ unique: true })
  tokenHash!: string

  @Column({ type: 'enum', enum: ['refresh'] })
  purpose!: 'refresh'

  @Column({ type: 'timestamptz' })
  expiresAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date
}
