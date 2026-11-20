import { showErrorToast, showSuccessToast } from '@/app/components/ui';

/**
 * Copies this case's address, saying so either way (#191). The clipboard can be
 * refused (no permission, an insecure origin, a headless browser) or missing,
 * and a refusal used to surface only as an uncaught rejection.
 */
export async function copyCaseLink(messages: { copied: string; failed: string }): Promise<boolean> {
    try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(window.location.href);
        showSuccessToast(messages.copied);
        return true;
    } catch {
        showErrorToast(messages.failed);
        return false;
    }
}
