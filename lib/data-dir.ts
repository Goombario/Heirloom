import path from 'path';

/**
 * Returns the data directory path.
 * Uses DATA_DIR env var if set (for Railway persistent volume), otherwise defaults to ./data
 */
export function getDataDir(): string {
    return process.env.DATA_DIR || path.join(process.cwd(), 'data');
}
