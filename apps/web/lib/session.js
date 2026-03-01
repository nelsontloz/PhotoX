const SESSION_STORAGE_KEY = "photox.session.v1";
const CSRF_COOKIE_KEY = "csrf_token";

let memorySession = null;

function canUseLocalStorage() {
  return typeof window !== "undefined" && window.localStorage;
}

function readCookie(name) {
  if (typeof document === "undefined") {
    return null;
  }

  const cookieValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookieValue) {
    return null;
  }

  return decodeURIComponent(cookieValue.slice(name.length + 1));
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
    accessToken: authPayload.accessToken || null,
    refreshToken: null,
    expiresIn: authPayload.expiresIn || 0,
    user: authPayload.user || null
  };

  memorySession = nextSession;
  if (canUseLocalStorage()) {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        accessToken: null,
        refreshToken: null,
        expiresIn: nextSession.expiresIn,
        user: nextSession.user
      })
    );
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

export function readCsrfToken() {
  return readCookie(CSRF_COOKIE_KEY);
}
