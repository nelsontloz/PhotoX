import { BadRequestException } from '@nestjs/common';
import { parseQueryBoolean } from './query-params';

describe('parseQueryBoolean', () => {
  it('accepts the two documented literals and real booleans', () => {
    expect(parseQueryBoolean('favorite', 'true')).toBe(true);
    expect(parseQueryBoolean('favorite', 'false')).toBe(false);
    expect(parseQueryBoolean('favorite', true)).toBe(true);
    expect(parseQueryBoolean('favorite', false)).toBe(false);
  });

  it('leaves an absent param undefined so @IsOptional applies', () => {
    expect(parseQueryBoolean('favorite', undefined)).toBeUndefined();
  });

  it('rejects anything else instead of coercing it to false', () => {
    for (const bad of ['1', '0', 'yes', 'TRUE', 'on', '', null, 1]) {
      expect(() => parseQueryBoolean('favorite', bad)).toThrow(BadRequestException);
    }
  });

  it('reports the field in the error envelope', () => {
    try {
      parseQueryBoolean('hasLocations', 'yes');
      expect.unreachable('should have thrown');
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body).toEqual({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'hasLocations must be true or false',
        details: [{ field: 'hasLocations', message: 'must be true or false' }],
      });
    }
  });
});
