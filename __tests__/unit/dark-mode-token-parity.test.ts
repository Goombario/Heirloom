import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * globals.css authors the dark palette once but is forced by CSS itself to
 * declare it twice — once under `html.dark` (manual toggle) and once under
 * `@media (prefers-color-scheme: dark) { :root:not(.light) { ... } }` (OS
 * preference) — with a comment mandating the two stay byte-identical. Nothing
 * previously verified that invariant: contrast-tokens.test.ts only ever parsed
 * the `html.dark` block, so a token retuned in one block and not the other
 * (this happened to --color-primary/--color-primary-dark/--color-primary-light)
 * silently shipped a different color to OS-dark-mode users than to users who
 * toggle dark mode manually, with no test catching it.
 */

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function parseTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const classStart = CSS.indexOf('html.dark {');
const classBlock = CSS.slice(classStart, CSS.indexOf('}', classStart));

const mediaAnchor = '@media (prefers-color-scheme: dark)';
const mediaStart = CSS.indexOf(mediaAnchor);
const innerStart = CSS.indexOf('{', CSS.indexOf('{', mediaStart) + 1); // second '{': the :root:not(.light) block
const mediaBlock = CSS.slice(innerStart, CSS.indexOf('}', innerStart));

const classTokens = parseTokens(classBlock);
const mediaTokens = parseTokens(mediaBlock);

describe('html.dark and @media(prefers-color-scheme: dark) stay byte-identical', () => {
  it('found both dark-mode token blocks', () => {
    expect(Object.keys(classTokens).length).toBeGreaterThan(20);
    expect(Object.keys(mediaTokens).length).toBeGreaterThan(20);
  });

  it('declares the same set of --color-* tokens in both blocks', () => {
    expect(Object.keys(mediaTokens).sort()).toEqual(Object.keys(classTokens).sort());
  });

  it.each(Object.keys(classTokens).map((token) => [token] as const))(
    '%s matches between html.dark and the OS-preference media query',
    (token) => {
      expect(mediaTokens[token], `${token} missing from the media-query block`).toBe(classTokens[token]);
    },
  );
});
