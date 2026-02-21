export function estimateStorageGb(uploadCount) {
  return Math.max(1, Math.round((uploadCount || 0) * 3.6));
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function initialsFromEmail(email) {
  const localPart = (email || "").split("@")[0] || "user";
  const chunks = localPart
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase());

  if (chunks.length >= 2) {
    return `${chunks[0]}${chunks[1]}`;
  }

  const compact = localPart.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length >= 2) {
    return compact.slice(0, 2).toUpperCase();
  }

  return "UX";
}
