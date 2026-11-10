import { chunk } from './chunk';

describe('chunk', () => {
  it('returns no batches for an empty list', () => {
    expect(chunk([])).toEqual([]);
  });

  it('splits an exact multiple without an empty trailing batch', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('keeps the trailing remainder', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it('defaults to 500 items per batch', () => {
    const batches = chunk(Array.from({ length: 1200 }, (_, i) => i));
    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 200]);
  });
});
