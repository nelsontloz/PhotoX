import { clearSession, readSession, writeSession } from "./session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

export class ApiClientError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function toDisplayMessage(error) {
  if (error instanceof ApiClientError) {
    return `${error.message} (${error.code})`;
  }

  return "Something went wrong. Please retry.";
}

export function formatApiError(error) {
  return toDisplayMessage(error);
}

export function isRetriableMediaProcessingError(error) {
  return (
    error instanceof ApiClientError &&
    error.code === "PLAYBACK_DERIVATIVE_NOT_READY" &&
    Boolean(error.details?.retriable)
  );
}

function buildUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function isBinaryBody(value) {
  if (!value) {
    return false;
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return true;
  }

  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    return true;
  }

  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
    return true;
  }

  return false;
}

async function parseJsonSafely(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function parseErrorEnvelope(status, payload) {
  if (payload && payload.error) {
    return new ApiClientError(
      status,
      payload.error.code || "API_ERROR",
      payload.error.message || "Request failed",
      payload.error.details || {}
    );
  }

  return new ApiClientError(status, "API_ERROR", "Request failed", {});
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (options.accessToken) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }

  let body = options.body;
  if (body !== undefined && !isBinaryBody(body)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path), {
    method: options.method || "GET",
    headers,
    body,
    signal: options.signal
  });

  const expectedResponse = options.expect || "json";

  if (!response.ok) {
    const payload = await parseJsonSafely(response);
    throw parseErrorEnvelope(response.status, payload);
  }

  if (expectedResponse === "blob") {
    return response.blob();
  }

  if (expectedResponse === "raw") {
    return response;
  }

  return parseJsonSafely(response);
}

export async function registerUser(payload) {
  return request("/auth/register", {
    method: "POST",
    body: payload
  });
}

export async function loginUser(payload) {
  return request("/auth/login", {
    method: "POST",
    body: payload
  });
}

export async function refreshSessionToken(refreshToken) {
  return request("/auth/refresh", {
    method: "POST",
    body: {
      refreshToken
    }
  });
}

export async function logoutUser(refreshToken) {
  return request("/auth/logout", {
    method: "POST",
    body: {
      refreshToken
    }
  });
}

async function requestWithAutoRefresh(path, options = {}) {
  const session = readSession();
  if (!session || !session.accessToken) {
    throw new ApiClientError(401, "AUTH_REQUIRED", "Please login to continue", {});
  }

  try {
    return await request(path, {
      ...options,
      accessToken: session.accessToken
    });
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401 || !session.refreshToken) {
      throw error;
    }

    const refreshed = await refreshSessionToken(session.refreshToken);
    writeSession(refreshed);

    return request(path, {
      ...options,
      accessToken: refreshed.accessToken
    });
  }
}

export async function fetchCurrentUser() {
  try {
    return await requestWithAutoRefresh("/me", {
      method: "GET"
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      clearSession();
    }
    throw error;
  }
}

export async function initUpload(payload, idempotencyKey) {
  return requestWithAutoRefresh("/uploads/init", {
    method: "POST",
    body: payload,
    headers: {
      "Idempotency-Key": idempotencyKey
    }
  });
}

export async function uploadPart(uploadId, partNumber, chunk) {
  return requestWithAutoRefresh(`/uploads/${uploadId}/part?partNumber=${partNumber}`, {
    method: "POST",
    body: chunk,
    headers: {
      "Content-Type": "application/octet-stream"
    }
  });
}

export async function completeUpload(uploadId, payload, idempotencyKey) {
  return requestWithAutoRefresh(`/uploads/${uploadId}/complete`, {
    method: "POST",
    body: payload,
    headers: {
      "Idempotency-Key": idempotencyKey
    }
  });
}

function buildTimelineQuery(params = {}) {
  const search = new URLSearchParams();

  if (params.cursor) {
    search.set("cursor", params.cursor);
  }

  if (params.limit) {
    search.set("limit", String(params.limit));
  }

  if (params.from) {
    search.set("from", params.from);
  }

  if (params.to) {
    search.set("to", params.to);
  }

  for (const key of ["favorite", "archived", "hidden"]) {
    if (params[key] !== undefined) {
      search.set(key, String(params[key]));
    }
  }

  if (params.q) {
    search.set("q", params.q);
  }

  const queryString = search.toString();
  return queryString.length > 0 ? `?${queryString}` : "";
}

export async function fetchTimeline(params = {}) {
  return requestWithAutoRefresh(`/library/timeline${buildTimelineQuery(params)}`, {
    method: "GET"
  });
}

export async function fetchMediaContentBlob(mediaId, variant = "thumb") {
  return requestWithAutoRefresh(`/media/${mediaId}/content?variant=${encodeURIComponent(variant)}`, {
    method: "GET",
    expect: "blob"
  });
}

export async function fetchMediaDetail(mediaId) {
  return requestWithAutoRefresh(`/media/${mediaId}`, {
    method: "GET"
  });
}

export async function deleteMedia(mediaId) {
  return requestWithAutoRefresh(`/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE"
  });
}

export async function restoreMedia(mediaId) {
  return requestWithAutoRefresh(`/media/${encodeURIComponent(mediaId)}/restore`, {
    method: "POST"
  });
}

function buildTrashQuery(params = {}) {
  const search = new URLSearchParams();
  if (params.cursor) {
    search.set("cursor", params.cursor);
  }
  if (params.limit) {
    search.set("limit", String(params.limit));
  }

  const queryString = search.toString();
  return queryString.length > 0 ? `?${queryString}` : "";
}

export async function listTrash(params = {}) {
  return requestWithAutoRefresh(`/library/trash${buildTrashQuery(params)}`, {
    method: "GET"
  });
}

export async function emptyTrash() {
  return requestWithAutoRefresh("/library/trash", {
    method: "DELETE"
  });
}

export async function fetchTrashPreviewBlob(mediaId, variant = "thumb") {
  return requestWithAutoRefresh(
    `/library/trash/${encodeURIComponent(mediaId)}/preview?variant=${encodeURIComponent(variant)}`,
    {
      method: "GET",
      expect: "blob"
    }
  );
}

export async function listAdminUsers(params = {}) {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }

  const query = search.toString();
  const suffix = query ? `?${query}` : "";
  return requestWithAutoRefresh(`/admin/users${suffix}`, { method: "GET" });
}

export async function createAdminManagedUser(payload) {
  return requestWithAutoRefresh("/admin/users", {
    method: "POST",
    body: payload
  });
}

export async function updateAdminManagedUser(userId, payload) {
  return requestWithAutoRefresh(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: payload
  });
}

export async function disableAdminManagedUser(userId) {
  return requestWithAutoRefresh(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

export async function resetAdminManagedUserPassword(userId, password) {
  return requestWithAutoRefresh(`/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body: { password }
  });
}

export async function fetchWorkerTelemetrySnapshot() {
  return requestWithAutoRefresh("/worker/telemetry/snapshot", {
    method: "GET"
  });
}

export async function fetchWorkerVideoEncodingProfile() {
  return requestWithAutoRefresh("/worker/settings/video-encoding", {
    method: "GET"
  });
}

export async function saveWorkerVideoEncodingProfile(profile) {
  return requestWithAutoRefresh("/worker/settings/video-encoding", {
    method: "PUT",
    body: {
      profile
    }
  });
}

export async function runWorkerOrphanSweep(payload = {}) {
  return requestWithAutoRefresh("/worker/orphan-sweep/run", {
    method: "POST",
    body: payload
  });
}

function parseSseChunks(buffer, onMessage) {
  const messages = buffer.split("\n\n");
  const trailing = messages.pop() || "";

  for (const rawMessage of messages) {
    const lines = rawMessage.split("\n");
    let event = "message";
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    try {
      const payload = JSON.parse(dataLines.join("\n"));
      onMessage({ event, payload });
    } catch (_err) {
      // Ignore malformed frames and continue stream parsing.
    }
  }

  return trailing;
}

export function openWorkerTelemetryStream({ onMessage, onOpen, onError }) {
  let stopped = false;
  const abortController = new AbortController();

  const start = async () => {
    try {
      const session = readSession();
      if (!session?.accessToken) {
        throw new ApiClientError(401, "AUTH_REQUIRED", "Please login to continue", {});
      }

      let accessToken = session.accessToken;
      let response;
      try {
        response = await request("/worker/telemetry/stream", {
          method: "GET",
          expect: "raw",
          accessToken,
          headers: {
            Accept: "text/event-stream"
          },
          signal: abortController.signal
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401 && session.refreshToken) {
          const refreshed = await refreshSessionToken(session.refreshToken);
          writeSession(refreshed);
          accessToken = refreshed.accessToken;
          response = await request("/worker/telemetry/stream", {
            method: "GET",
            expect: "raw",
            accessToken,
            headers: {
              Accept: "text/event-stream"
            },
            signal: abortController.signal
          });
        } else {
          throw error;
        }
      }

      if (!response.body || typeof response.body.getReader !== "function") {
        throw new Error("SSE stream body is not readable");
      }

      if (typeof onOpen === "function") {
        onOpen();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseChunks(buffer, onMessage);
      }
    } catch (error) {
      if (!stopped && typeof onError === "function") {
        onError(error);
      }
    }
  };

  start();

  return {
    close() {
      stopped = true;
      abortController.abort();
    }
  };
}

export function createIdempotencyKey(prefix) {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
  return `${prefix}-${id}`;
}

export async function createAlbum(payload) {
  return requestWithAutoRefresh("/albums", {
    method: "POST",
    body: payload
  });
}

export async function listAlbums(limit = 50) {
  return requestWithAutoRefresh(`/albums?limit=${limit}`, {
    method: "GET"
  });
}

export async function addMediaToAlbum(albumId, payload) {
  return requestWithAutoRefresh(`/albums/${encodeURIComponent(albumId)}/items`, {
    method: "POST",
    body: payload
  });
}

export async function listAlbumItems(albumId) {
  return requestWithAutoRefresh(`/albums/${encodeURIComponent(albumId)}/items`, {
    method: "GET"
  });
}

export async function getAlbumById(albumId) {
  return requestWithAutoRefresh(`/albums/${encodeURIComponent(albumId)}`, {
    method: "GET"
  });
}

export async function removeMediaFromAlbum(albumId, mediaId) {
  return requestWithAutoRefresh(`/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(mediaId)}`, {
    method: "DELETE"
  });
}
