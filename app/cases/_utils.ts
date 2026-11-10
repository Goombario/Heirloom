export function parseDate(s: string): Date {
    return new Date(/[Z+]/.test(s) ? s : s + 'Z');
}
