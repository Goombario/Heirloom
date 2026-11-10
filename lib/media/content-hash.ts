/**
 * SHA-256 over the ORIGINAL uploaded bytes — never the compressed ones (#592).
 *
 * The originals are the only stable identity: both upload paths re-encode to
 * JPEG, so a sharp/libvips upgrade would silently change a hash taken after
 * compression. Hashing originals also lets the browser compute the same value
 * before uploading, which is what makes the pre-flight check possible.
 *
 * Web Crypto is used deliberately over node:crypto so one implementation serves
 * the Node service, the PGlite client, and the browser doing pre-flight.
 */
export async function hashBytes(bytes: Uint8Array | ArrayBuffer): Promise<string> {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // Copy into a fresh, exactly-sized buffer: a Uint8Array can be a window onto
    // a larger one (Buffer.from() pools exactly like this), and digest() would
    // otherwise hash the whole pool rather than these bytes.
    const exact = new Uint8Array(view.byteLength);
    exact.set(view);
    const digest = await crypto.subtle.digest('SHA-256', exact);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Hex SHA-256 as produced by `hashBytes` — validated at every trust boundary. */
export const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
