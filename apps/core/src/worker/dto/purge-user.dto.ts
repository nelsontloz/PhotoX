import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// backupPrefix is only read when the user row is already gone (a retried purge), so the
// caller passes the one it was enqueued with.
export class PurgeUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @ApiProperty()
  backupPrefix!: string;
}
