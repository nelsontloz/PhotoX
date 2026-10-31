import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { UploadSessionStatus } from '@photox/shared-types';

// Resumable chunked upload session (`api/v1/uploads`). Created pending, chunk rows land in
// upload_session_parts, complete() assembles/dedups and stamps completedFileId/completedAssetId.
// originalName is a display-only hint — storage keys and MIME sniffing never trust it.
@Entity('upload_sessions')
export class UploadSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  @Index()
  userId!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: UploadSessionStatus;

  @Column({ type: 'int' })
  chunkSizeBytes!: number;

  @Column({ type: 'int' })
  totalParts!: number;

  @Column({ type: 'bigint' })
  expectedSizeBytes!: number;

  @Column({ type: 'char', length: 64, nullable: true })
  checksumSha256!: string | null;

  @Column({ type: 'text' })
  originalName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  takenAt!: Date | null;

  @Column({ type: 'timestamptz' })
  @Index()
  expiresAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  completedFileId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  completedAssetId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
