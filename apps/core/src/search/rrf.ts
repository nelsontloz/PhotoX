const RRF_K = 50

// Fixed bonus for person/place name matches: equivalent to a rank-1 hit in one retrieval branch,
// so a routed asset ties the strongest ANN/FTS hit instead of dominating it.
export const ROUTE_BONUS = 1 / (RRF_K + 1)

interface FusedHit {
  id: string
  score: number
}

/**
 * Reciprocal Rank Fusion over ordered id lists (rank = index + 1), plus a flat bonus for routed
 * ids. Scores are summed per id; ties keep first-seen order (stable sort).
 */
export function fuseRrf(
  lists: string[][],
  bonusIds: ReadonlySet<string> = new Set(),
  k = RRF_K,
): FusedHit[] {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1))
    })
  }
  for (const id of bonusIds) {
    scores.set(id, (scores.get(id) ?? 0) + ROUTE_BONUS)
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
