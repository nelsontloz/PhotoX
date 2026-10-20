import { ApiProperty } from '@nestjs/swagger'
import { IsString } from 'class-validator'

// ponytail: shape-only validation here — length/whitespace rules reject with 422 in the
// service so the worker's CoreClient treats them as unrecoverable without retrying
export class RegisterOcrDto {
  @ApiProperty({ description: 'Concatenated OCR text (1-50000 chars after trim)' })
  @IsString()
  text!: string
}
