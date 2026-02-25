/**
 * In-memory mock of pg.Pool for contract testing.
 *
 * Intercepts SQL queries via pattern matching and operates on
 * in-memory Maps instead of PostgreSQL. This eliminates the need
 * for a running database during provider pact verification.
 */

/* ---------- in-memory stores ---------- */
const users = new Map(); // keyed by id
const sessions = new Map(); // keyed by id

/* ---------- helpers ---------- */

function now() {
    return new Date().toISOString();
}

function userRow(u) {
    return {
        id: u.id,
        email: u.email,
        password_hash: u.password_hash,
        is_admin: u.is_admin,
        is_active: u.is_active,
        created_at: u.created_at || now(),
        updated_at: u.updated_at || now()
    };
}

function sessionRow(s) {
    return {
        id: s.id,
        user_id: s.user_id,
        refresh_token_hash: s.refresh_token_hash,
        expires_at: s.expires_at,
        revoked_at: s.revoked_at || null,
        created_at: s.created_at || now()
    };
}

/* ---------- SQL router ---------- */

function routeQuery(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();

    // ---- migration / DDL no-ops ----
    if (/CREATE TABLE|ALTER TABLE|CREATE INDEX|schema_migrations/i.test(text)) {
        if (/SELECT filename FROM schema_migrations/i.test(text)) {
            return { rows: [{ filename: params?.[0] }], rowCount: 1 };
        }
        if (/INSERT INTO schema_migrations/i.test(text)) {
            return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }

    // ---- transaction control ----
    if (/^BEGIN$/i.test(text) || /^COMMIT$/i.test(text) || /^ROLLBACK$/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // ---- advisory lock ----
    if (/pg_advisory_xact_lock/i.test(text)) {
        return { rows: [], rowCount: 0 };
    }

    // ---- to_regclass (media table check) ----
    if (/to_regclass/i.test(text)) {
        return { rows: [{ media_table: null, media_flags_table: null }], rowCount: 1 };
    }

    // ---- users ----
    if (/INSERT INTO users/i.test(text)) {
        const [id, email, password_hash, is_admin_or_expr, is_active] = params || [];
        const hasAdminAlready = [...users.values()].some((u) => u.is_admin);
        // "NOT EXISTS (SELECT 1 FROM users WHERE is_admin = true)" is the expression
        // for self-registration; is_admin_or_expr is a boolean for admin-created users.
        const isAdmin =
            typeof is_admin_or_expr === "boolean"
                ? is_admin_or_expr
                : !hasAdminAlready;

        const existing = [...users.values()].find((u) => u.email === email);
        if (existing) {
            const err = new Error(`duplicate key value violates unique constraint "users_email_key"`);
            err.code = "23505";
            err.constraint = "users_email_key";
            throw err;
        }

        const row = userRow({
            id,
            email,
            password_hash,
            is_admin: isAdmin,
            is_active: is_active !== undefined ? is_active : true
        });
        users.set(id, row);
        return { rows: [row], rowCount: 1 };
    }

    if (/SELECT .* FROM users WHERE email/i.test(text)) {
        const email = params?.[0];
        const found = [...users.values()].find((u) => u.email === email);
        return { rows: found ? [userRow(found)] : [], rowCount: found ? 1 : 0 };
    }

    if (/SELECT .* FROM users WHERE id/i.test(text)) {
        const id = params?.[0];
        const found = users.get(id);
        return { rows: found ? [userRow(found)] : [], rowCount: found ? 1 : 0 };
    }

    if (/UPDATE users/i.test(text)) {
        const id = params?.[0];
        const found = users.get(id);
        if (!found) {
            return { rows: [], rowCount: 0 };
        }

        // Parse SET clauses from the parameterized query
        const setClauses = text.match(/SET (.+?) WHERE/i)?.[1] || "";
        let paramIdx = 1; // $1 is id
        if (/email\s*=\s*\$/i.test(setClauses)) {
            paramIdx++;
            found.email = params[paramIdx - 1];
        }
        if (/password_hash\s*=\s*\$/i.test(setClauses)) {
            paramIdx++;
            found.password_hash = params[paramIdx - 1];
        }
        if (/is_admin\s*=\s*\$/i.test(setClauses)) {
            paramIdx++;
            found.is_admin = params[paramIdx - 1];
        }
        if (/is_active\s*=\s*\$/i.test(setClauses)) {
            paramIdx++;
            found.is_active = params[paramIdx - 1];
        }
        found.updated_at = now();

        users.set(id, found);
        return { rows: [userRow(found)], rowCount: 1 };
    }

    // Count active admins
    if (/COUNT.*FROM users WHERE is_admin/i.test(text)) {
        const count = [...users.values()].filter((u) => u.is_admin && u.is_active).length;
        return { rows: [{ count }], rowCount: 1 };
    }

    // List users with stats (SELECT ... FROM users u ... LIMIT $1 OFFSET $2)
    if (/FROM users\b.*LIMIT/i.test(text)) {
        const limit = params?.[0] ?? 25;
        const offset = params?.[1] ?? 0;
        const allUsers = [...users.values()]
            .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
            .map((u) => ({ ...userRow(u), upload_count: 0 }));
        const paged = allUsers.slice(offset, offset + limit);
        return { rows: paged, rowCount: paged.length };
    }

    // Total users count
    if (/COUNT.*total_users.*FROM users$/i.test(text)) {
        return { rows: [{ total_users: users.size }], rowCount: 1 };
    }

    // ---- sessions ----
    if (/INSERT INTO sessions/i.test(text)) {
        const [id, user_id, refresh_token_hash, expires_at] = params || [];
        const row = sessionRow({ id, user_id, refresh_token_hash, expires_at });
        sessions.set(id, row);
        return { rows: [row], rowCount: 1 };
    }

    if (/SELECT .* FROM sessions WHERE id/i.test(text)) {
        const id = params?.[0];
        const found = sessions.get(id);
        return { rows: found ? [sessionRow(found)] : [], rowCount: found ? 1 : 0 };
    }

    if (/UPDATE sessions\s+SET refresh_token_hash/i.test(text) && /WHERE id/i.test(text)) {
        // rotateSessionToken
        const [id, refresh_token_hash, expires_at] = params || [];
        const found = sessions.get(id);
        if (!found) {
            return { rows: [], rowCount: 0 };
        }
        found.refresh_token_hash = refresh_token_hash;
        found.expires_at = expires_at;
        found.revoked_at = null;
        sessions.set(id, found);
        return { rows: [sessionRow(found)], rowCount: 1 };
    }

    if (/UPDATE sessions SET refresh_token_hash = \$1 WHERE user_id = \$2/i.test(text)) {
        const [refresh_token_hash, user_id] = params || [];
        let updated = 0;
        for (const [sessionId, session] of sessions) {
            if (session.user_id !== user_id) {
                continue;
            }
            session.refresh_token_hash = refresh_token_hash;
            sessions.set(sessionId, session);
            updated += 1;
        }

        return { rows: [], rowCount: updated };
    }

    if (/UPDATE sessions\s+SET revoked_at.*WHERE id/i.test(text)) {
        // revokeById
        const id = params?.[0];
        const found = sessions.get(id);
        if (found && !found.revoked_at) {
            found.revoked_at = now();
            sessions.set(id, found);
        }
        return { rows: [], rowCount: found ? 1 : 0 };
    }

    if (/UPDATE sessions\s+SET revoked_at.*WHERE user_id/i.test(text)) {
        // revokeByUserId
        const userId = params?.[0];
        let count = 0;
        for (const [id, s] of sessions) {
            if (s.user_id === userId && !s.revoked_at) {
                s.revoked_at = now();
                sessions.set(id, s);
                count++;
            }
        }
        return { rows: [], rowCount: count };
    }

    // ---- DELETE helpers for state handlers ----
    if (/DELETE FROM sessions WHERE user_id/i.test(text)) {
        const userId = params?.[0];
        for (const [id, s] of sessions) {
            if (s.user_id === userId) sessions.delete(id);
        }
        return { rows: [], rowCount: 0 };
    }

    if (/DELETE FROM sessions/i.test(text) && !params?.length) {
        sessions.clear();
        return { rows: [], rowCount: 0 };
    }

    if (/DELETE FROM users WHERE id/i.test(text)) {
        const id = params?.[0];
        users.delete(id);
        return { rows: [], rowCount: 0 };
    }

    if (/DELETE FROM users/i.test(text) && !params?.length) {
        users.clear();
        return { rows: [], rowCount: 0 };
    }

    // Fallback — log and return empty
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
            async query(sql, params) {
                return routeQuery(sql, params);
            },
            release() { },
            async end() { }
        };
    },

    async end() { },

    /* ---- test helpers ---- */
    reset() {
        users.clear();
        sessions.clear();
    },

    seedUser({ id, email, password_hash, is_admin = false, is_active = true }) {
        const row = userRow({ id, email, password_hash, is_admin, is_active });
        users.set(id, row);
        return row;
    },

    seedSession({ id, user_id, refresh_token_hash, expires_at }) {
        const row = sessionRow({
            id,
            user_id,
            refresh_token_hash,
            expires_at: expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        sessions.set(id, row);
        return row;
    }
};

module.exports = mockPool;
