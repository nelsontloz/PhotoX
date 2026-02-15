const DEFAULT_NEXT_PATH = "/upload";

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
