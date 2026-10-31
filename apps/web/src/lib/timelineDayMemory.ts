// Day-level scroll memory for the home timeline: per tab, survives reload, no URL churn.
const KEY = 'photox.timeline.day';
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// ponytail: sessionStorage is written from the scroll handler, so skip unchanged days rather than
// throttling; upgrade path = whenScrollIdle() if the writes ever show up in a profile.
let lastSaved: string | null = null;
// A reload restores the day; navigating back to the timeline (same document) must not, so the
// stored day is handed out once per document — that is the whole difference between the two.
let consumed = false;

/** The remembered day (`YYYY-MM-DD`) on the first call of this document load, else null. */
export function takeSavedDay(): string | null {
  if (consumed) return null;
  consumed = true;
  try {
    const value = sessionStorage.getItem(KEY);
    return value !== null && DAY_KEY.test(value) ? value : null;
  } catch {
    return null; // storage blocked (private mode / restricted cookies): memory is best-effort
  }
}

export function saveDay(sortKey: string): void {
  if (sortKey === lastSaved) return;
  lastSaved = sortKey;
  try {
    sessionStorage.setItem(KEY, sortKey);
  } catch {
    // ignore — position memory must never break scrolling
  }
}

/** Test seam: a fresh document load. */
export function resetDayMemory(): void {
  consumed = false;
  lastSaved = null;
}
