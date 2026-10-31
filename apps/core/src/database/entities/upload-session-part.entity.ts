import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UploadSession } from './upload-session.entity';

// One row per received chunk; PK (sessionId, partIndex) makes an identical re-PUT idempotent
// at the row level. CASCADE removes parts with the session (DELETE /uploads/:id, swept expiry).
@Entity('upload_session_parts')
export class UploadSessionPart {
  @PrimaryColumn('uuid')
  sessionId!: string;

  @ManyToOne(() => UploadSession, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'sessionId' })
  session!: UploadSession;

  @PrimaryColumn('int')
  partIndex!: number;

  @Column({ type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'char', length: 64, nullable: true })
  checksumSha256!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
