export function buildHeaders(
  user: { id: string; email: string },
  requestId: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    'x-request-id': requestId,
    'x-user-id': user.id,
    'x-user-email': user.email,
    ...extra,
  }
}
