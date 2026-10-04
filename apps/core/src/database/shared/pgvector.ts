import { fromSql, toSql } from 'pgvector'

/**
 * TypeORM transformer for text-stored pgvector columns (number[] <-> '[1,2,3]').
 * `dim` guards writes to fixed-dimension columns (faces.embedding is unguarded: legacy rows vary).
 */
export function vectorTransformer(dim?: number, label = 'embedding') {
  return {
    to: (v: number[]): string => {
      if (dim !== undefined && v.length !== dim) {
        throw new Error(`${label} must be ${dim}-dim (got ${v.length})`)
      }
      return toSql(v) as string
    },
    from: (v: string): number[] => fromSql(v) as number[],
  }
}
