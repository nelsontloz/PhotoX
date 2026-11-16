import { IsArray, ArrayMaxSize, IsUUID } from 'class-validator';

export class TrashAssetsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  assetIds!: string[];
}
