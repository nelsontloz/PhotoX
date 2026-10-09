interface RouteCandidates {
  persons: { id: string; name: string }[]
  places: string[]
}

interface RouteHits {
  personIds: string[]
  places: string[]
}

/**
 * ponytail: naive case-insensitive substring routing ("sar" matches person "Sarah", "paris"
 * matches placeCity "Paris") — cheap, predictable, and explainable for a personal library.
 * Upgrade to token/embedding matching only if this proves noisy in practice.
 */
export function routeMatches(q: string, candidates: RouteCandidates): RouteHits {
  const needle = q.trim().toLowerCase()
  if (needle === '') return { personIds: [], places: [] }
  return {
    personIds: candidates.persons
      .filter((p) => p.name.toLowerCase().includes(needle))
      .map((p) => p.id),
    places: candidates.places.filter((p) => p.toLowerCase().includes(needle)),
  }
}
