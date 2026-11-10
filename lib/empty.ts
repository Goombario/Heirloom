// Empty stub aliased in place of Node-only built-ins (fs, net, tls, dns) for the
// browser bundle. `getDataClient()` is reachable from always-loaded client
// components (e.g. GlobalSearch in the root layout). In hosted ('http') mode the
// pg-backed Local data client is never executed, but the bundler still compiles
// its module graph — which reaches `pg` and its Node built-in imports. Aliasing
// those built-ins to this empty module (browser condition only) lets the dead
// branch resolve without pulling Node internals into the client bundle. The
// server build is unaffected (the alias is browser-scoped). See next.config.ts.
const emptyModule = {};
export default emptyModule;

// PGlite's `dist/fs/nodefs.js` statically imports these named `fs` exports. In
// the browser PGlite uses its idb/memory FS, so nodefs is never instantiated and
// these are never called — they exist only so Turbopack's static export check
// resolves (the `fs` builtin is aliased to this module browser-side).
export const existsSync = (): boolean => false;
export const mkdirSync = (): undefined => undefined;
export const constants = Object.freeze({ O_RDONLY: 0, O_NOFOLLOW: 0 });

// `lib/media-thumbnail.ts` (sharp-backed, server-only) statically imports these
// named `fs/promises` exports. Browser-side `fs/promises` is aliased here; the
// thumbnail/cleanup code never runs client-side, so these are never called.
const notInBrowser = async (): Promise<never> => {
  throw new Error('fs/promises is not available in the browser');
};
export const readFile = notInBrowser;
export const writeFile = notInBrowser;
export const rename = notInBrowser;
export const mkdir = notInBrowser;
export const readdir = notInBrowser;
export const unlink = notInBrowser;
export const link = notInBrowser;
export const lstat = notInBrowser;
export const open = notInBrowser;
export const realpath = notInBrowser;
