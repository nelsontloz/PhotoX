import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// ponytail: the albums + persons list endpoints share this exact limit/offset contract;
// search + admin-users extend it (redeclaring limit for their stricter max caps)
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(1000)
  // type: Number is load-bearing — an initializer-only field emits design:type Object, which
  // swagger renders as an `object` query param that swagger-ui then refuses to send
  @ApiProperty({ type: Number, default: 20, required: false, maximum: 1000 })
  limit = 20;

  // @IsInt: inherited by search/admin-users (both had it); tightens albums/persons
  // float offsets from a potential 500 to a 400 — the safe direction
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiProperty({ type: Number, default: 0, required: false })
  offset = 0;
}
