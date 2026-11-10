/**
 * Size caps for imports (#1222, security audit M-1 and L-8). They bound the
 * memory one request can use: parsing holds several copies of the text, so
 * peak memory is a few times the file size. The hosted routes and the browser
 * build share these values, and so does the zip path, so a zip can never carry
 * a file the server would refuse.
 */

/**
 * Largest `.ged` (or bundle sidecar) an import accepts. A 100 MB GEDCOM holds
 * several hundred thousand people; family exports are a few MB.
 */
export const MAX_GEDCOM_BYTES = 100 * 1024 * 1024;

/** Largest `.xlsx` a spreadsheet import accepts, as uploaded (compressed). */
export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

/**
 * Largest total an `.xlsx` may inflate to. An `.xlsx` is a zip, so a 10 MB
 * upload can inflate to gigabytes (a zip bomb) before the workbook is read.
 */
export const MAX_SPREADSHEET_INFLATED_BYTES = 128 * 1024 * 1024;

/** Most rows any one sheet of a spreadsheet import may have, header included. */
export const MAX_SPREADSHEET_ROWS = 50_000;

/** Whole megabytes, for messages that name a cap. */
export function capInMegabytes(bytes: number): number {
    return Math.floor(bytes / (1024 * 1024));
}
