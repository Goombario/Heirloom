import { ValidationError } from '@/lib/validation';
import { PDF_CONTENT_TYPE, hasPdfSignature } from './allowed-extensions';
import type { ProcessedImage } from './process-image';

/**
 * The local-first build's counterpart to `processForUpload` for a PDF (#510):
 * the bytes are stored as they came, once they prove to be a PDF. Shares the
 * image result's shape so both upload paths store either kind the same way.
 */
export async function processPdfForUpload(file: Blob): Promise<ProcessedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfSignature(bytes)) throw new ValidationError('The file is not a valid PDF');
  return { bytes, contentType: PDF_CONTENT_TYPE, format: 'PDF', width: 0, height: 0 };
}
