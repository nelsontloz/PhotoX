import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNumber, IsOptional, IsString } from 'class-validator'

// ponytail: shape-only validation here — length/whitespace/range rules reject with 422 in the
// service so the worker's CoreClient treats them as unrecoverable without retrying
export class RegisterOcrDto {
  @ApiProperty({ description: 'Concatenated OCR text (1-50000 chars after trim)' })
  @IsString()
  text!: string

  @ApiPropertyOptional({ nullable: true, example: 'eng', description: '2-8 chars when present' })
  @IsOptional()
  @IsString()
  lang?: string | null

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  confidence?: number | null
}
