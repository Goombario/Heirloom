import type JSZip from 'jszip';

/** JSZip's documented `ZipObject.internalStream`, which its typings omit. */
interface EntryStream {
    on(event: 'data', listener: (chunk: Uint8Array) => void): EntryStream;
    on(event: 'error', listener: (err: Error) => void): EntryStream;
    on(event: 'end', listener: () => void): EntryStream;
    pause(): EntryStream;
    resume(): EntryStream;
}

/**
 * Inflate one entry, stopping as soon as the bytes produced pass `maxBytes`.
 * The header's declared size can lie, so the cap is enforced on the bytes
 * actually produced. With `keep: false` the bytes are counted and dropped.
 * Resolves to the bytes (or an empty array when not kept) and the count, or
 * null when the entry is too large.
 */
function inflateCapped(
    entry: JSZip.JSZipObject,
    maxBytes: number,
    keep: boolean,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; total: number } | null> {
    return new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        let settled = false;
        const stream = (entry as unknown as { internalStream(type: 'uint8array'): EntryStream }).internalStream('uint8array');
        stream
            .on('data', (chunk: Uint8Array) => {
                if (settled) return;
                total += chunk.length;
                if (total > maxBytes) {
                    settled = true;
                    stream.pause();
                    resolve(null);
                    return;
                }
                if (keep) chunks.push(chunk);
            })
            .on('error', (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            })
            .on('end', () => {
                if (settled) return;
                settled = true;
                const out = new Uint8Array(keep ? total : 0);
                let offset = 0;
                for (const chunk of chunks) {
                    out.set(chunk, offset);
                    offset += chunk.length;
                }
                resolve({ bytes: out, total });
            })
            .resume();
    });
}

/** Inflate one entry under `maxBytes`. Returns null when it is too large. */
export async function readEntryCapped(entry: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
    const result = await inflateCapped(entry, maxBytes, true);
    return result ? result.bytes : null;
}

/**
 * Whether every entry of the zip together inflates to at most `maxTotalBytes`.
 * Reads the entries one at a time and keeps nothing, so a zip bomb is stopped
 * after `maxTotalBytes` of output rather than exhausting memory.
 */
export async function zipInflatesWithin(zip: JSZip, maxTotalBytes: number): Promise<boolean> {
    let remaining = maxTotalBytes;
    for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const result = await inflateCapped(entry, remaining, false);
        if (!result) return false;
        remaining -= result.total;
    }
    return true;
}
