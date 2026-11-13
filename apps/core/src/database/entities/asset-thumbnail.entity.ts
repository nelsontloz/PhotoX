import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Asset } from './asset.entity';

@Entity('asset_thumbnails')
@Unique(['assetId', 'size'])
// the orphan sweep's `NOT IN (SELECT id FROM files)` predicates on fileId; unindexed it seq-scans
@Index('idx_asset_thumbnails_file_id', ['fileId'])
export class AssetThumbnail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  assetId!: string;

  @ManyToOne(() => Asset, (a) => a.thumbnails, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'assetId' })
  asset!: Asset;

  @Column({ type: 'text' })
  size!: string;

  @Column({ type: 'uuid' })
  fileId!: string;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  @Column({ type: 'bigint' })
  bytes!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
