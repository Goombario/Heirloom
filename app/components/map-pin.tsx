// Shared ink map pin. Used by MapLibre markers (as a custom HTML element on
// the location map and the static header preview) and the journey modal (numbered
// variant). The pin fills with the ink --color-link CSS var; black stroke keeps it
// visible on any tile color (colorblind-safe — shape + outline, never color alone).

/** Raw SVG markup string for a MapLibre `Marker` element. */
export function pinSvgHtml(): string {
  return `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="overflow:visible">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 8.25 12 20 12 20S24 20.25 24 12C24 5.373 18.627 0 12 0z" fill="var(--color-link)" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="4.5" fill="#ffffff"/>
    </svg>`;
}

/** Raw SVG markup string for a numbered MapLibre `Marker` element (journey stops). */
export function numberedPinSvgHtml(n: number): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="overflow:visible">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 8.94 13 21 13 21s13-12.06 13-21C26 5.82 20.18 0 13 0z" fill="var(--color-link)" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
      <text x="13" y="17" text-anchor="middle" font-size="12" font-weight="700" fill="#000000" font-family="system-ui, sans-serif">${n}</text>
    </svg>`;
}

/** React (JSX) variant of the ink pin, for rendering as an absolutely-positioned overlay. */
export function MapPin({ size = 24 }: { size?: number }) {
  const h = Math.round((size / 24) * 32);
  return (
    <svg width={size} height={h} viewBox="0 0 24 32" aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 8.25 12 20 12 20S24 20.25 24 12C24 5.373 18.627 0 12 0z" fill="var(--color-link)" stroke="#000000" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="4.5" fill="#ffffff" />
    </svg>
  );
}
