const SESSION_STORAGE_KEY = "photox.session.v1";

let memorySession = null;

function canUseLocalStorage() {
  return typeof window !== "undefined" && window.localStorage;
}

function notifySessionChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("photox:session-changed"));
  }
}

export function readSession() {
  if (!canUseLocalStorage()) {
    return memorySession;
  }

  const serialized = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!serialized) {
    return null;
  }

  try {
    return JSON.parse(serialized);
  } catch (_error) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function writeSession(authPayload) {
  const nextSession = {
    accessToken: authPayload.accessToken,
    refreshToken: authPayload.refreshToken,
    expiresIn: authPayload.expiresIn,
    user: authPayload.user
  };

  memorySession = nextSession;
  if (canUseLocalStorage()) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  }

  notifySessionChanged();
  return nextSession;
}

export function clearSession() {
  memorySession = null;
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  notifySessionChanged();
}

export function readRefreshToken() {
  const session = readSession();
  return session ? session.refreshToken : null;
}
