import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsString } from 'class-validator'
import { SEARCH_EMBEDDING_DIM } from '@photox/shared-types'

// ponytail: shape-only validation here — kind/model/dim rules reject with 422 in the service so
// the worker's CoreClient treats them as unrecoverable without retrying
export class RegisterEmbeddingDto {
  @ApiProperty({ example: 'image', description: "Currently only 'image'" })
  @IsString()
  kind!: string

  @ApiProperty({ example: 'siglip2-b16-224' })
  @IsString()
  model!: string

  @ApiProperty({ type: [Number], description: `${SEARCH_EMBEDDING_DIM}-dim embedding` })
  @IsArray()
  embedding!: number[]
}
