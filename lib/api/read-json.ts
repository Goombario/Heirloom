import { ValidationError } from '@/lib/validation';

/**
 * Reads a JSON object request body. Malformed JSON, an empty body, `null`, an
 * array or a scalar is a 400 `ValidationError` rather than the 500 a raw
 * `request.json()` (or destructuring its `null`) used to give (#51, L-1).
 *
 * Typed `any` like `request.json()` itself: each route still validates the
 * fields it reads, and this only guarantees the body is a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonObject<T = any>(request: Request): Promise<T> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        throw new ValidationError('Request body must be valid JSON');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object');
    }
    return body as T;
}
