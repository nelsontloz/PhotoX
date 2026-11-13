import type { ValueTransformer } from 'typeorm';

/**
 * `bigint` arrives as a string from pg by default — a 64-bit value can exceed
 * Number.MAX_SAFE_INTEGER, which a JS number cannot hold. Every bigint in this schema is a byte
 * count (file sizes, thumbnail bytes, upload expectations), orders of magnitude below that limit,
 * so narrowing at the entity boundary is exact. It also makes the entity's declared `number` true:
 * without it, `'123' !== 123` silently fails any comparison a call site forgets to convert.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
