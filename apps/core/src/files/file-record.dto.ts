import { ApiProperty } from '@nestjs/swagger';
import type { FileRecord } from '../database/entities';
import type { FileRecord as FileRecordWire } from '@photox/shared-types';

export class FileRecordDto implements FileRecordWire {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  storageKey!: string;

  @ApiProperty()
  originalName!: string;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty()
  checksumSha256!: string;

  @ApiProperty({ enum: ['original', 'transcode'] })
  purpose!: 'original' | 'transcode';

  @ApiProperty({ required: false, nullable: true })
  assetId!: string | null;

  @ApiProperty()
  createdAt!: string;

  static from(record: FileRecord): FileRecordDto {
    const dto = new FileRecordDto();
    dto.id = record.id;
    dto.userId = record.userId;
    dto.storageKey = record.storageKey;
    dto.originalName = record.originalName;
    dto.mimeType = record.mimeType;
    // bigint columns come back as strings from pg — the wire type says number
    dto.sizeBytes = Number(record.sizeBytes);
    dto.checksumSha256 = record.checksumSha256;
    dto.purpose = record.purpose;
    dto.assetId = record.assetId;
    dto.createdAt = record.createdAt.toISOString();
    return dto;
  }
}
