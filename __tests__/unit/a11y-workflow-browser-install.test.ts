import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(process.cwd(), '.github', 'workflows', 'a11y.yml'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('a11y workflow browser installation', () => {
  it('disables the unrelated Chrome apt source before Playwright installs Linux dependencies', () => {
    const disableChromeRepository = workflow.indexOf(
      'sudo rm -f /etc/apt/sources.list.d/google-chrome.list /etc/apt/sources.list.d/google-chrome.sources',
    );
    const installPlaywright = workflow.indexOf(
      'npm exec -- playwright install --with-deps --only-shell chromium',
    );

    expect(disableChromeRepository).toBeGreaterThan(-1);
    expect(installPlaywright).toBeGreaterThan(disableChromeRepository);
  });
});
