import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { isQueryTrue } from '../../common/query-params';

// `DELETE api/v1/assets` empties the whole trash, so it refuses to run without this explicit
// filter: a client that drops its query string must not delete a library. `@IsBoolean` is what
// keeps the field whitelisted (a transform alone carries no validator metadata), and
// `forbidNonWhitelisted` then rejects `ids`/`limit`/... on the same call.
export class PurgeTrashQueryDto {
  @Transform(({ value }) => isQueryTrue(value))
  @IsBoolean()
  @ApiProperty({ type: Boolean, example: true, description: 'Required: must be true' })
  isTrashed!: boolean;
}
