/** Toggle an id in a Set, returning a new Set (for use as a setState updater). */
export function toggleId(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
