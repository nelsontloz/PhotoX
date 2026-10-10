// Query params arrive as strings; only literal true/'true' count as true. Shared by the
// class-transformer @Transform decorators and by controllers reading raw @Query strings.
export function isQueryTrue(value: unknown): boolean {
  return value === true || value === 'true'
}
