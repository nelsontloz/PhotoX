import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// The offset-addressed list contract (`/albums`, `/persons`). Endpoints that cap lower or page by
// cursor declare their own `limit`/`cursor` (search, admin-users, album assets, assets) — the cap
// belongs to the resource, not to the parameter name.
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  // type: Number is load-bearing — an initializer-only field emits design:type Object, which
  // swagger renders as an `object` query param that swagger-ui then refuses to send
  @ApiProperty({ type: Number, default: 20, required: false, maximum: 1000 })
  limit = 20;

  // @IsInt on both fields: a float offset/limit reached SQL as `OFFSET 1.5` and 500'd
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiProperty({ type: Number, default: 0, required: false })
  offset = 0;
}
