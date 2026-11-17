import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ClaimTransferDto {
  // 1-based BullMQ attempt number, so a crash-retried claim can re-claim its own running row
  @IsInt()
  @Min(1)
  @ApiProperty({ minimum: 1 })
  attempt!: number;
}
