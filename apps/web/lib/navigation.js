const DEFAULT_NEXT_PATH = "/timeline";

export function resolveNextPath(pathValue) {
  if (!pathValue || typeof pathValue !== "string") {
    return DEFAULT_NEXT_PATH;
  }

  if (!pathValue.startsWith("/") || pathValue.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }

  return pathValue;
}

export function buildLoginPath(nextPath = DEFAULT_NEXT_PATH) {
  const resolved = resolveNextPath(nextPath);
  return `/login?next=${encodeURIComponent(resolved)}`;
}

export function shouldAutoRedirectAuthenticatedAuthPage({ hasAccessToken, hasNextParam }) {
  return Boolean(hasAccessToken) && !hasNextParam;
}
