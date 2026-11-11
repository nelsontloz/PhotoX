import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { isQueryTrue } from '../../common/query-params';

// One DTO for both layout routes: the month index reads `tz`, the window page reads `from`/`to`/
// `offset`/`limit`, and the legacy no-param call still works. `forbidNonWhitelisted` is global, so
// new layout params must be declared here.
export class LayoutQueryDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9_+\-/]{1,64}$/)
  @ApiProperty({ required: false, example: 'Europe/Madrid', description: 'IANA timezone' })
  tz?: string;

  @IsOptional()
  @IsUUID('4')
  @ApiProperty({ required: false, description: 'Filter to assets containing this person' })
  personId?: string;

  @IsOptional()
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ required: false })
  favorite?: boolean;

  @IsOptional()
  @IsUUID('4')
  @ApiProperty({ required: false, description: 'Filter to assets in this album' })
  albumId?: string;

  @IsOptional()
  @IsISO8601()
  @ApiProperty({
    required: false,
    example: '2024-03-01T00:00:00.000Z',
    description: 'Window start (inclusive), echoed from the month index',
  })
  from?: string;

  @IsOptional()
  @IsISO8601()
  @ApiProperty({
    required: false,
    example: '2024-04-01T00:00:00.000Z',
    description: 'Window end (exclusive), echoed from the month index',
  })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @ApiProperty({ default: 0, required: false })
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(5000)
  @ApiProperty({ default: 2000, required: false })
  limit?: number;
}
