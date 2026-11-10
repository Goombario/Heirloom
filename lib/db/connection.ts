import { Pool, PoolClient, QueryResult, types } from 'pg';
import { initializeSchema } from './init-schema';
import { initializeMembershipSchema, reconcileMembership } from './init-membership';
import { debugLog } from '@/lib/logger';

/**
 * Read `int8` (every `COUNT`, a `SUM` of integers, `Places."OsmId"`) as a number,
 * as PGlite does. node-pg's default is a string, so the same query typed
 * `childCount: number` returned "3" here and 3 in the static and desktop builds
 * (#868). Past `Number.MAX_SAFE_INTEGER` the text is kept rather than rounded;
 * PGlite returns a BigInt there, and no column of ours reaches it.
 */
function parseInt8(text: string): number | string {
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : text;
}

const poolTypes = {
    getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        oid === types.builtins.INT8 && format !== 'binary'
            ? parseInt8
            : types.getTypeParser(oid, format as 'text')) as typeof types.getTypeParser,
};

// Singleton connection pool
let pool: Pool | null = null;
let schemaInitialized = false;
let schemaInitPromise: Promise<void> | null = null;

function getPool(): Pool {
    if (!pool) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is not set');
        }

        const created = new Pool({
            connectionString,
            types: poolTypes,
            max: 20,
            idleTimeoutMillis: 30000,
            // 2000 was too tight to survive a blip: every checkout failed at once and
            // every route 500'd together (2026-07-27). A slow connect is worth waiting
            // out; a failed one costs a whole request.
            connectionTimeoutMillis: 10000,
        });

        created.on('error', (err) => {
            console.error('Unexpected PostgreSQL pool error:', err);
            // Discard the pool rather than just logging. pg raises this for an idle
            // client that died, and usually evicts that one client itself — but we
            // cannot tell "one dead socket" from "every socket is dead", and the
            // second case used to persist until the process was restarted: all API
            // routes 500ing while Postgres itself was healthy and idle. Rebuilding is
            // cheap because getPool() is lazy — no connection is opened until the next
            // query — and `schemaInitialized` deliberately stays set, since the schema
            // lives in the database, which never went away.
            if (pool === created) pool = null;
            // Release whatever sockets the discarded pool still holds. In-flight
            // queries on already-checked-out clients finish; nothing new is routed
            // here because the singleton no longer points at it. Swallow the rejection
            // — end() throws if the pool already ended, and there is nothing to do
            // about it inside an error handler.
            void created.end().catch(() => {});
        });

        pool = created;
        debugLog('PostgreSQL pool created');
    }

    return pool;
}

/** Ensure schema is initialized (runs once, subsequent calls are no-ops) */
async function ensureSchema(): Promise<void> {
    if (schemaInitialized) return;
    if (!schemaInitPromise) {
        schemaInitPromise = (async () => {
            const client = await getPool().connect();
            try {
                await client.query('BEGIN');
                await client.query(`SELECT pg_advisory_xact_lock(hashtext('genealogy_schema_init'))`);
                await initializeSchema(client);
                // Hosted membership (ADR 0029). DESKTOP_MODE has its own local-user
                // boundary and never creates or reads these tables.
                if (process.env.DESKTOP_MODE !== 'true') {
                    await initializeMembershipSchema(client);
                    await reconcileMembership(client);
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                throw err;
            } finally {
                client.release();
            }
        })()
            .then(() => {
                schemaInitialized = true;
                debugLog('Database schema initialized');
            })
            .catch((err) => {
                schemaInitPromise = null;
                throw err;
            });
    }
    return schemaInitPromise;
}

/** Execute a single query using the pool */
export async function query(text: string, params?: unknown[]): Promise<QueryResult> {
    await ensureSchema();
    return getPool().query(text, params);
}

/** Get a client for transactions (must call client.release() when done) */
export async function getClient(): Promise<PoolClient> {
    await ensureSchema();
    return getPool().connect();
}

/** Close and reset the singleton pool for short-lived administrative CLIs. */
export async function closePool(): Promise<void> {
    const current = pool;
    pool = null;
    schemaInitialized = false;
    schemaInitPromise = null;
    if (current) await current.end();
}
