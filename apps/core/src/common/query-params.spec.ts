import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { isQueryTrue } from './query-params';

/**
 * The strict query-parameter boolean: only the four literal spellings the API documents are
 * accepted, `undefined` means false, and everything else is a 400 in the standard envelope.
 * `TRUE`, `1`, `yes`, arrays and the empty string are the spellings clients actually send.
 */
describe('isQueryTrue', () => {
  it('treats a missing parameter as false', () => {
    expect(isQueryTrue(undefined)).toBe(false);
  });

  it('accepts exactly the four documented spellings', () => {
    expect(isQueryTrue(true)).toBe(true);
    expect(isQueryTrue('true')).toBe(true);
    expect(isQueryTrue(false)).toBe(false);
    expect(isQueryTrue('false')).toBe(false);
  });

  it.each([
    ['an array', ['true']],
    ['an empty string', ''],
    ["'1'", '1'],
    ["'TRUE'", 'TRUE'],
    ["'yes'", 'yes'],
    ['null', null],
    ['a number', 1],
    ['an object', { true: true }],
  ])('rejects %s with a BadRequestException', (_label, value) => {
    expect(() => isQueryTrue(value)).toThrow(BadRequestException);
  });
});
