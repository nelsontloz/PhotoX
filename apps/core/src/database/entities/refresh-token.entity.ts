import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('refresh_tokens')
// logout-all and the account wipe delete by userId; without this they scan the session table
@Index('idx_refresh_tokens_user_id', ['userId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  // one device session per login; every rotation in the chain keeps it, so a logout (or a
  // reuse kill) can delete just this device's rows and leave the user's other devices alone.
  // The default lets `synchronize` add the column to a populated dev table (one session per
  // existing row); app inserts always set it explicitly.
  @Index()
  @Column({ type: 'uuid', default: () => 'uuid_generate_v4()' })
  sessionId!: string;

  @Column({ unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  @Index()
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  absoluteExpiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
