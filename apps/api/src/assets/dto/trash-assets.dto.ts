import { IsArray, IsString, MinLength } from 'class-validator'

export class TrashAssetsDto {
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  assetIds!: string[]
}
