import { describe, expect, it } from 'vitest';
import { aboutBuildEnv, buildCommit, DEFAULT_SOURCE_URL, sourceUrl } from '@/lib/about/build-env';
import { runningAs } from '@/lib/about';

const noGit = () => '';

describe('About build env (#1256)', () => {
  it('takes the first commit variable a build host provides, shortened', () => {
    expect(buildCommit({ RAILWAY_GIT_COMMIT_SHA: '3F9A2C1D0E', GITHUB_SHA: 'aaaaaaa' }, noGit)).toBe('3f9a2c1');
    expect(buildCommit({ SOURCE_COMMIT: 'bbbbbbbbbb', RAILWAY_GIT_COMMIT_SHA: 'ccccccc' }, noGit)).toBe('bbbbbbb');
    expect(buildCommit({ WORKERS_CI_COMMIT_SHA: 'ddddddd' }, noGit)).toBe('ddddddd');
  });

  it('falls back to git, and to nothing when there is no usable commit', () => {
    expect(buildCommit({}, () => '0123456789abcdef')).toBe('0123456');
    expect(buildCommit({}, noGit)).toBe('');
    expect(buildCommit({ SOURCE_COMMIT: 'not a sha' }, noGit)).toBe('');
  });

  it('links the upstream repository when SOURCE_URL is unset or blank', () => {
    expect(DEFAULT_SOURCE_URL).toBe('https://github.com/Goombario/Heirloom');
    expect(sourceUrl({})).toBe(DEFAULT_SOURCE_URL);
    expect(sourceUrl({ SOURCE_URL: '  ' })).toBe(DEFAULT_SOURCE_URL);
  });

  it('lets SOURCE_URL point the link at a fork, web links only', () => {
    expect(sourceUrl({ SOURCE_URL: 'https://example.org/fork/heirloom' })).toBe('https://example.org/fork/heirloom');
    expect(sourceUrl({ NEXT_PUBLIC_SOURCE_URL: 'https://example.org/x' })).toBe('https://example.org/x');
    expect(sourceUrl({ SOURCE_URL: 'javascript:alert(1)' })).toBe('');
    expect(sourceUrl({ SOURCE_URL: 'not a url' })).toBe('');
  });

  it('bakes the build date and the hosted flag', () => {
    const env = aboutBuildEnv({ HEIRLOOM_HOSTED: 'true' }, new Date('2026-11-07T05:00:00Z'), noGit);
    expect(env).toEqual({
      NEXT_PUBLIC_BUILD_COMMIT: '',
      NEXT_PUBLIC_BUILD_DATE: '2026-11-07',
      NEXT_PUBLIC_SOURCE_URL: DEFAULT_SOURCE_URL,
      NEXT_PUBLIC_HOSTED: 'true',
    });
    expect(aboutBuildEnv({}, new Date(), noGit).NEXT_PUBLIC_HOSTED).toBe('');
  });
});

describe('runningAs', () => {
  it('names each of the four build kinds', () => {
    expect(runningAs('http', false, true)).toBe('hosted');
    expect(runningAs('http', false, false)).toBe('self_hosted');
    expect(runningAs('local', false, false)).toBe('browser');
    expect(runningAs('local', true, false)).toBe('desktop');
  });
});
