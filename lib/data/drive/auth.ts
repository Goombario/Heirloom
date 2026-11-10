import { DRIVE_CLIENT_ID, DRIVE_SCOPE } from './config';

/**
 * Google Identity Services (GIS) token management for Drive backup.
 *
 * Browser-only. Uses the GIS implicit token flow: a ~1 hr access token, held in
 * memory only (never localStorage — that would be an XSS-exfiltration surface).
 * There is no refresh token in the browser flow, so background sync is
 * impossible by design; re-acquisition happens on the next user action and is
 * usually silent because the Google session + prior consent still exist.
 *
 * Only a boolean "connected" flag is persisted, so the UI can show state without
 * forcing a re-consent just to render.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const CONNECTED_KEY = 'heirloom_drive_connected';
/** Refresh a little before the real expiry to avoid using a just-expired token. */
const EXPIRY_SKEW_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (resp: TokenResponse) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let gisPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiry = 0;

/** Inject the GIS script once and resolve when the oauth2 API is available. */
function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('GIS requires a browser'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;

  gisPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const onLoad = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error('Google Identity Services failed to initialise'));
    };
    if (existing) {
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load GIS')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load GIS')), { once: true });
    document.head.appendChild(script);
  }).catch((err) => {
    gisPromise = null; // allow retry after a transient failure
    throw err;
  });
  return gisPromise;
}

/**
 * Return a valid access token, requesting one via GIS if needed.
 * @param interactive when true, force the consent prompt (first connect / re-grant).
 */
export async function getToken(interactive: boolean): Promise<string> {
  if (!interactive && accessToken && Date.now() < tokenExpiry - EXPIRY_SKEW_MS) {
    return accessToken;
  }
  await loadGis();
  const oauth2 = window.google!.accounts!.oauth2!;

  return new Promise<string>((resolve, reject) => {
    tokenClient ??= oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'No access token returned'));
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000;
        resolve(accessToken);
      },
    });
    // '' = silent (no popup) when a prior grant exists; 'consent' = force the dialog.
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

/** Interactive first connect: force consent, then remember the connected flag. */
export async function connectDrive(): Promise<void> {
  await getToken(true);
  if (typeof localStorage !== 'undefined') localStorage.setItem(CONNECTED_KEY, 'true');
}

/** Revoke the in-memory token and clear the connected flag. */
export async function disconnectDrive(): Promise<void> {
  if (accessToken && typeof window !== 'undefined') {
    window.google?.accounts?.oauth2?.revoke(accessToken);
  }
  accessToken = null;
  tokenExpiry = 0;
  if (typeof localStorage !== 'undefined') localStorage.removeItem(CONNECTED_KEY);
}

/** Whether the user previously connected Drive (persisted flag, not a live token check). */
export function isDriveConnected(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(CONNECTED_KEY) === 'true';
}
