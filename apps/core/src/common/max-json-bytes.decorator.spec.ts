import { IsObject, IsOptional, validate } from 'class-validator';
import { MaxJsonBytes } from './max-json-bytes.decorator';

class Payload {
  @IsOptional()
  @IsObject()
  @MaxJsonBytes(32)
  metadata?: Record<string, unknown>;
}

describe('MaxJsonBytes', () => {
  it('accepts an absent, null or in-budget blob', async () => {
    expect(await validate(new Payload())).toHaveLength(0);
    expect(await validate(Object.assign(new Payload(), { metadata: null }))).toHaveLength(0);
    expect(await validate(Object.assign(new Payload(), { metadata: { a: 1 } }))).toHaveLength(0);
  });

  it('rejects a blob whose serialized size exceeds the budget', async () => {
    const errors = await validate(
      Object.assign(new Payload(), { metadata: { blob: 'x'.repeat(33) } }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints?.maxJsonBytes).toContain('at most 32 bytes');
  });
});
