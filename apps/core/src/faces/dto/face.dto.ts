import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class FaceBoxResponseDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  x!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  y!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  w!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  h!: number;
}
