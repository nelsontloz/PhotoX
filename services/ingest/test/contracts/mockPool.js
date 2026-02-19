/**
 * In-memory mock of pg.Pool for the ingest-service provider pact tests.
 *
 * Covers tables: upload_sessions, upload_parts, media, idempotency_keys,
 * schema_migrations (no-op), and all DDL.
 */

const crypto = require("node:crypto");

/* ---------- in-memory stores ---------- */
const uploadSessions = new Map(); // keyed by id
const uploadParts = new Map();    // keyed by `${uploadId}:${partNumber}`
const media = new Map();          // keyed by id
const idempotencyKeys = new Map(); // keyed by `${userId}:${scope}:${idemKey}`
const schemaMigrations = new Set();

/* ---------- helpers ---------- */
const now = () => new Date().toISOString();

function sessionRow(s) {
    return {
        id: s.id,
        user_id: s.user_id,
        file_name: s.file_name,
        content_type: s.content_type,
        file_size: s.file_size,
        checksum_sha256: s.checksum_sha256,
        part_size: s.part_size,
        status: s.status,
        expires_at: s.expires_at,
        media_id: s.media_id || null,
        storage_relative_path: s.storage_relative_path || null,
        created_at: s.created_at,
        updated_at: s.updated_at
    };
}

function partRow(p) {
    return {
        upload_id: p.upload_id,
        part_number: p.part_number,
        byte_size: p.byte_size,
        checksum_sha256: p.checksum_sha256,
        relative_part_path: p.relative_part_path,
        created_at: p.created_at
    };
}

function mediaRow(m) {
    return {
        id: m.id,
        owner_id: m.owner_id,
        relative_path: m.relative_path,
        mime_type: m.mime_type,
        status: m.status,
        checksum_sha256: m.checksum_sha256,
        sort_at: m.sort_at,
        created_at: m.created_at,
        updated_at: m.updated_at
    };
}

function idemRow(k) {
    return {
        user_id: k.user_id,
        scope: k.scope,
        idem_key: k.idem_key,
        request_hash: k.request_hash,
        response_body: k.response_body,
        status_code: k.status_code
    };
}

/* ---------- SQL router ---------- */
function routeQuery(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();

    // ---- DDL / migration no-ops ----
    if (/CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE EXTENSION|DO \$\$/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // ---- schema_migrations ----
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    if (/SELECT filename FROM schema_migrations WHERE filename/i.test(text)) {
        const fn = params[0];
        return { rows: schemaMigrations.has(fn) ? [{ filename: fn }] : [], rowCount: schemaMigrations.has(fn) ? 1 : 0 };
    }
    if (/INSERT INTO schema_migrations/i.test(text)) {
        schemaMigrations.add(params[0]);
        return { rows: [], rowCount: 1 };
    }

    // ---- BEGIN / COMMIT / ROLLBACK ----
    if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text) || /^ROLLBACK$/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // ---- upload_sessions ----
    if (/INSERT INTO upload_sessions/i.test(text)) {
        const ts = now();
        const s = {
            id: params[0], user_id: params[1], file_name: params[2],
            content_type: params[3], file_size: params[4], checksum_sha256: params[5],
            part_size: params[6], status: "initiated", expires_at: params[7],
            media_id: null, storage_relative_path: null, created_at: ts, updated_at: ts
        };
        uploadSessions.set(s.id, s);
        return { rows: [sessionRow(s)], rowCount: 1 };
    }

    if (/SELECT .* FROM upload_sessions WHERE id = \$1 AND user_id = \$2/i.test(text)) {
        const s = uploadSessions.get(params[0]);
        if (s && s.user_id === params[1]) {
            return { rows: [sessionRow(s)], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    if (/UPDATE upload_sessions SET status = 'completed'/i.test(text) || /SET status = 'completed'/i.test(text)) {
        const s = uploadSessions.get(params[0]);
        if (s && s.user_id === params[1]) {
            s.status = "completed";
            s.media_id = params[2];
            s.storage_relative_path = params[3];
            s.updated_at = now();
            return { rows: [sessionRow(s)], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    if (/UPDATE upload_sessions SET status = 'aborted'/i.test(text)) {
        const s = uploadSessions.get(params[0]);
        if (s && s.user_id === params[1]) {
            s.status = "aborted";
            s.updated_at = now();
            return { rows: [sessionRow(s)], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    if (/UPDATE upload_sessions SET status = \$3/i.test(text)) {
        const s = uploadSessions.get(params[0]);
        if (s && s.user_id === params[1]) {
            s.status = params[2];
            s.updated_at = now();
            return { rows: [sessionRow(s)], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    // ---- upload_parts ----
    if (/INSERT INTO upload_parts/i.test(text)) {
        const ts = now();
        const key = `${params[0]}:${params[1]}`;
        const p = {
            upload_id: params[0], part_number: params[1], byte_size: params[2],
            checksum_sha256: params[3], relative_part_path: params[4], created_at: ts
        };
        uploadParts.set(key, p);
        return { rows: [partRow(p)], rowCount: 1 };
    }

    if (/SELECT .* FROM upload_parts WHERE upload_id = \$1 ORDER BY part_number/i.test(text)) {
        const parts = [];
        for (const [, p] of uploadParts) {
            if (p.upload_id === params[0]) parts.push(partRow(p));
        }
        parts.sort((a, b) => a.part_number - b.part_number);
        return { rows: parts, rowCount: parts.length };
    }

    if (/SELECT COALESCE\(SUM\(byte_size\)/i.test(text)) {
        let total = 0;
        for (const [, p] of uploadParts) {
            if (p.upload_id === params[0]) total += Number(p.byte_size);
        }
        return { rows: [{ uploaded_bytes: String(total) }], rowCount: 1 };
    }

    // ---- media ----
    if (/INSERT INTO media/i.test(text)) {
        const ts = now();
        const sortAt = params[6] || ts;
        const m = {
            id: params[0], owner_id: params[1], relative_path: params[2],
            mime_type: params[3], status: params[4], checksum_sha256: params[5],
            sort_at: sortAt,
            created_at: ts, updated_at: ts
        };
        media.set(m.id, m);
        return { rows: [mediaRow(m)], rowCount: 1 };
    }

    if (/SELECT .* FROM media WHERE id = \$1$/i.test(text) || /SELECT .* FROM media WHERE id = \$1\s*$/i.test(text)) {
        const m = media.get(params[0]);
        return { rows: m ? [mediaRow(m)] : [], rowCount: m ? 1 : 0 };
    }

    if (/FROM media m LEFT JOIN media_flags/i.test(text) && /owner_id = \$1/i.test(text) && /checksum_sha256 = \$2/i.test(text)) {
        for (const [, m] of media) {
            if (m.owner_id === params[0] && m.checksum_sha256 === params[1]) {
                return { rows: [mediaRow(m)], rowCount: 1 };
            }
        }
        return { rows: [], rowCount: 0 };
    }

    // ---- idempotency_keys ----
    if (/SELECT .* FROM idempotency_keys WHERE user_id = \$1 AND scope = \$2 AND idem_key = \$3/i.test(text)) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const k = idempotencyKeys.get(key);
        return { rows: k ? [idemRow(k)] : [], rowCount: k ? 1 : 0 };
    }

    if (/INSERT INTO idempotency_keys/i.test(text) && /ON CONFLICT/i.test(text)) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const existing = idempotencyKeys.get(key);
        if (existing) {
            const row = idemRow(existing);
            row.inserted = false;
            return { rows: [row], rowCount: 1 };
        }
        const k = {
            user_id: params[0], scope: params[1], idem_key: params[2],
            request_hash: params[3],
            response_body: typeof params[4] === "string" ? JSON.parse(params[4]) : params[4],
            status_code: params[5]
        };
        idempotencyKeys.set(key, k);
        const row = idemRow(k);
        row.inserted = true;
        return { rows: [row], rowCount: 1 };
    }

    if (/INSERT INTO idempotency_keys/i.test(text) && !/ON CONFLICT/i.test(text)) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const k = {
            user_id: params[0], scope: params[1], idem_key: params[2],
            request_hash: params[3],
            response_body: typeof params[4] === "string" ? JSON.parse(params[4]) : params[4],
            status_code: params[5]
        };
        idempotencyKeys.set(key, k);
        return { rows: [], rowCount: 1 };
    }

    console.warn("[mockPool] unhandled query:", text, params);
    return { rows: [], rowCount: 0 };
}

/* ---------- mock pool object ---------- */
const mockPool = {
    async query(sql, params) {
        return routeQuery(sql, params);
    },
    async connect() {
        return {
            async query(sql, params) { return routeQuery(sql, params); },
            release() { }
        };
    },
    async end() { },

    /* ---- test helpers ---- */
    reset() {
        uploadSessions.clear();
        uploadParts.clear();
        media.clear();
        idempotencyKeys.clear();
        schemaMigrations.clear();
    },

    seedUploadSession({ id, user_id, file_name, content_type, file_size, checksum_sha256, part_size, status, expires_at, media_id, storage_relative_path }) {
        const ts = now();
        uploadSessions.set(id, {
            id, user_id, file_name, content_type, file_size: String(file_size),
            checksum_sha256, part_size, status: status || "initiated",
            expires_at: expires_at || new Date(Date.now() + 86400000).toISOString(),
            media_id: media_id || null, storage_relative_path: storage_relative_path || null, created_at: ts, updated_at: ts
        });
    },

    seedUploadPart({ upload_id, part_number, byte_size, checksum_sha256, relative_part_path }) {
        const key = `${upload_id}:${part_number}`;
        uploadParts.set(key, {
            upload_id, part_number, byte_size,
            checksum_sha256: checksum_sha256 || "0".repeat(64),
            relative_part_path: relative_part_path || `_tmp/${upload_id}/part-${part_number}`,
            created_at: now()
        });
    },

    seedMedia({ id, owner_id, relative_path, mime_type, status, checksum_sha256 }) {
        const ts = now();
        media.set(id, {
            id, owner_id, relative_path, mime_type: mime_type || "image/jpeg",
            status: status || "processing", checksum_sha256: checksum_sha256 || "0".repeat(64),
            sort_at: ts,
            created_at: ts, updated_at: ts
        });
    }
};

module.exports = mockPool;
