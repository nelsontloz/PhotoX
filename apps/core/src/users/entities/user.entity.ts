import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ unique: true })
  email!: string

  @Column({ type: 'enum', enum: ['user', 'admin'] })
  role!: 'user' | 'admin'

  @Column()
  passwordHash!: string

  @Column()
  displayName!: string

  @Column({ type: 'timestamptz', nullable: true })
  tokensValidAfter!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
