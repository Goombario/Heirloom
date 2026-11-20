/**
 * Saves a blob through a download link. The static build and the desktop app
 * have no file routes, so anything they hand the user to keep goes this way.
 */
export function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking at once can cancel the download before the browser reads it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
