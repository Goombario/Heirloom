import { ValidationError } from '@/lib/validation';

const UPLOAD_INTENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the opaque, client-generated upload replay key before any mutation. */
export function validateUploadIntentId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length !== 36 || !UPLOAD_INTENT_PATTERN.test(value)) {
    throw new ValidationError('Invalid upload intent');
  }
  return value.toLowerCase();
}

/** PostgreSQL and PGlite both expose SQLSTATE 23505 for unique races. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}
