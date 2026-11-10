# 0039 — A PDF is media, drawn in the browser and viewed in the browser's own viewer

**Date:** 2026-10-29 · **Context:** #510, #1201 · **Status:** Accepted · **Area:** media

Families keep scanned certificates, registers and letters as PDFs. Before #510 the media
store took images only, so a document had to be converted to pictures page by page, or kept
outside the app.

## Decision

1. **A PDF is a media row, not a new kind of record.** It sits in the same `Media` table,
   quota, `MediaLink` owners and GEDCOM `OBJE` export as a photo, and the Library's Photos
   tab becomes Media, with a Type filter. A link can be scoped to Birth, Death or Marriage
   (ADR 0030), which is what shows a register on that fact's row.
2. **A document has no faces and is never a portrait.** Face tags, face capture and
   setting it as a profile picture are refused in the services and hidden in the UI. Its
   "people" are the people it is linked to, which the viewer lists as Linked to.
3. **Thumbnails are drawn in the browser.** Neither build can draw a PDF where it stores
   one (sharp reads images; the local build keeps bytes in PGlite), so pdf.js draws the
   first page at display time, two at a time, cached for the session. Nothing is stored,
   so there is no schema change and no stale poster. A PDF pdf.js can't read, such as an
   encrypted one, shows a plain document icon.
4. **The viewer is the browser's.** Desktop frames the stored file, so paging, zoom,
   search and print come from the browser. The file route serves a PDF without the
   `sandbox` CSP images get, because Chrome's PDF viewer will not run in a sandboxed
   frame; it keeps `frame-ancestors 'self'`. A phone, or a browser without a viewer
   (`navigator.pdfViewerEnabled`), shows the first page and hands the file to the device.
5. **Only PDF.** Plain text and other office formats are out; per-citation files are
   #1201.

## Rejected

- **Render posters on upload.** It needs a PDF renderer on the server and a second one in
  the local build, a new column or blob table, and a backfill for imported files.
- **Draw every page with pdf.js in an app viewer.** It rebuilds what the browser already
  does, and loses its search, print and accessibility.
- **Keep the sandbox and use pdf.js inside it.** The sandbox exists for SVG and HTML
  smuggled as images; a PDF is checked for its `%PDF-` signature at upload and is served
  as `application/pdf` with `nosniff`, so the browser's viewer is the only thing that runs.

## Consequences

- pdf.js loads only when a document is first drawn. Pages that use the JBIG2 or JPEG 2000
  decoders, which pdf.js runs as WebAssembly, draw blank in the hosted build, whose CSP has
  no `wasm-unsafe-eval`; the browser's viewer still shows them.
- The static build's `_headers` and the Tauri CSP allow `frame-src blob:`, since the local
  build frames the file as a blob URL.
