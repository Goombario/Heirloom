#!/usr/bin/env node
// CI helper for #75: decides whether a pull request is version-only or
// docs-only, and writes `version_only` and `docs_only` to $GITHUB_OUTPUT.
// Usage: node scripts/ci-pr-changes.mjs <base-sha>
// The base commit must be fetched; HEAD is the PR's merge commit.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { classifyPrChanges } from './lib/pr-changes.mjs';

const base = process.argv[2];
if (!base) {
  console.error('usage: ci-pr-changes.mjs <base-sha>');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const files = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
const read = (path, side) => {
  try {
    return git('show', `${side === 'base' ? base : 'HEAD'}:${path}`);
  } catch {
    return null;
  }
};

const { versionOnly, docsOnly } = classifyPrChanges(files, read);
console.log(`${files.length} changed file(s); version_only=${versionOnly} docs_only=${docsOnly}`);

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, `version_only=${versionOnly}\ndocs_only=${docsOnly}\n`);
