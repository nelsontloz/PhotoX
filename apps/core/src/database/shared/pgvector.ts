/**
 * TypeORM transformer for text-stored pgvector columns (number[] <-> '[1,2,3]').
 * `dim` guards writes to fixed-dimension columns (faces.embedding is unguarded: legacy rows vary).
 */
export function toVectorSql(v: number[]): string {
  // JSON.stringify(number[]) is exactly '[1,2,3]' — the inverse of the from side's JSON.parse
  return JSON.stringify(v);
}

export function vectorTransformer(dim?: number, label = 'embedding') {
  return {
    to: (v: number[]): string => {
      if (dim !== undefined && v.length !== dim) {
        throw new Error(`${label} must be ${dim}-dim (got ${v.length})`);
      }
      return toVectorSql(v);
    },
    from: (v: string): number[] => JSON.parse(v) as number[],
  };
}
