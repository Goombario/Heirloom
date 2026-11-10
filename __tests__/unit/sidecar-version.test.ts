import { describe, it, expect } from 'vitest';
import { SIDECAR_VERSION, sidecarVersionWarning } from '@/lib/gedcom/sidecar-version';

/**
 * Guard for the one thing `version` is allowed to do (ADR 0009). Sidecars are
 * additive-only, so nothing may branch on version to choose a parse path; the
 * field exists solely to warn that a bundle came from a newer build than this
 * one reads. Before #399 all three sidecars WROTE a version and none read it.
 */
describe('sidecarVersionWarning', () => {
    it('warns when the bundle declares a newer version than this build reads', () => {
        const warning = sidecarVersionWarning('sources.json', { version: SIDECAR_VERSION + 1 });
        expect(warning).toEqual({
            code: 'sidecar_version_newer',
            values: {
                sidecarName: 'sources.json',
                declared: SIDECAR_VERSION + 1,
                supported: SIDECAR_VERSION,
            },
        });
    });

    it('names the sidecar it came from, so a multi-sidecar bundle is diagnosable', () => {
        expect(sidecarVersionWarning('media.json', { version: 99 })?.values.sidecarName).toBe('media.json');
        expect(sidecarVersionWarning('cases.json', { version: 99 })?.values.sidecarName).toBe('cases.json');
    });

    it('is silent for the current version', () => {
        expect(sidecarVersionWarning('sources.json', { version: SIDECAR_VERSION })).toBeNull();
    });

    it('is silent for an older version — additive-only means old bundles still read', () => {
        expect(sidecarVersionWarning('sources.json', { version: SIDECAR_VERSION - 1 })).toBeNull();
    });

    it('is silent when version is missing, non-numeric, or the input is not an object', () => {
        expect(sidecarVersionWarning('sources.json', {})).toBeNull();
        expect(sidecarVersionWarning('sources.json', { version: 'two' })).toBeNull();
        expect(sidecarVersionWarning('sources.json', { version: NaN })).toBeNull();
        expect(sidecarVersionWarning('sources.json', null)).toBeNull();
        expect(sidecarVersionWarning('sources.json', 'nope')).toBeNull();
    });
});
