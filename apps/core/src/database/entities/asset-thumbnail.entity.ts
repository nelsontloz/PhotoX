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
import { bigintTransformer } from '../shared/bigint';

@Entity('asset_thumbnails')
@Unique(['assetId', 'size'])
// the orphan sweep's `NOT IN (SELECT id FROM files)` predicates on fileId; unindexed it seq-scans
@Index('idx_asset_thumbnails_file_id', ['fileId'])
export class AssetThumbnail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // `uuid`, not the varchar a bare `@Column()` infers: the migrations (and the FK to assets)
  // have always used uuid, so the entity was the drifting side.
  @Column('uuid')
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

  @Column({ type: 'bigint', transformer: bigintTransformer })
  bytes!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
