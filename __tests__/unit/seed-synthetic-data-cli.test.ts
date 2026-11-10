import { describe, expect, it } from 'vitest';
import { parseSyntheticCliArgs } from '@/scripts/seed-synthetic-data';

describe('synthetic data CLI arguments', () => {
  it('requires an account selector for hosted mode', () => {
    expect(() => parseSyntheticCliArgs(['hosted'])).toThrow('Hosted mode requires --email');
    expect(parseSyntheticCliArgs(['hosted', '--email', 'qa@example.test'])).toMatchObject({
      mode: 'hosted', email: 'qa@example.test', treeName: 'Synthetic QA Fixture', treeId: null,
    });
  });

  it('accepts a numeric existing tree target without enabling replacement', () => {
    expect(parseSyntheticCliArgs(['hosted', '--email', 'qa@example.test', '--tree-id', '42'])).toMatchObject({ treeId: 42, replace: false });
    expect(() => parseSyntheticCliArgs(['hosted', '--email', 'qa@example.test', '--tree-id', '0'])).toThrow('tree-id must be a positive integer');
  });

  it('parses static generation and verification inputs', () => {
    expect(parseSyntheticCliArgs(['static', '--output', 'out/synthetic.hlbak'])).toMatchObject({ mode: 'static', output: 'out/synthetic.hlbak' });
    expect(parseSyntheticCliArgs(['verify', '--input', 'out/synthetic.hlbak'])).toMatchObject({ mode: 'verify', input: 'out/synthetic.hlbak' });
    expect(() => parseSyntheticCliArgs(['static', '--email', 'nope'])).toThrow('Unknown option');
    expect(() => parseSyntheticCliArgs(['verify'])).toThrow('Verify mode requires --input');
  });
});
