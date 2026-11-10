import { RuleTester } from 'eslint';
import { describe, it, afterAll } from 'vitest';
import rule from '../../eslint-rules/no-inline-static-literal.mjs';

// Wire ESLint's RuleTester into vitest's globals. These statics are runtime
// hooks not present on the @types/eslint RuleTester surface, so assign them
// through a loose alias rather than the typed class.
const RTStatics = RuleTester as unknown as Record<string, unknown>;
RTStatics.describe = describe;
RTStatics.it = it;
RTStatics.itOnly = it.only;
RTStatics.afterAll = afterAll;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-inline-static-literal', rule, {
  valid: [
    // --- token references (already the "right way") ---
    { code: `const x = <div style={{ color: 'var(--accent)' }} />;` },
    { code: `const x = <div style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} />;` },
    { code: `const x = <div style={{ background: 'color-mix(in srgb, var(--card) 80%, transparent)' }} />;` },
    // --- computed / dynamic values (legitimate #175 cases) ---
    { code: `const x = <div style={{ left: pos }} />;` },
    { code: `const x = <div style={{ width: THUMB }} />;` },
    { code: `const x = <div style={{ opacity: visible ? 1 : 0 }} />;` },
    { code: 'const x = <div style={{ transform: `translate(${a}px, ${b}px)` }} />;' },
    { code: `const x = <div style={{ marginLeft: i === 0 ? 0 : offset }} />;` },
    // --- calc / env / min / max safe-area math ---
    { code: `const x = <div style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }} />;` },
    { code: `const x = <div style={{ paddingTop: 'max(env(safe-area-inset-top), 40px)' }} />;` },
    // --- border/length that carries a token color (the 1px is conventional, color is a token) ---
    { code: `const x = <div style={{ border: '1px solid var(--border)' }} />;` },
    // --- non-dimensional numerics are not tokenizable spacing/size ---
    { code: `const x = <div style={{ zIndex: 20 }} />;` },
    { code: `const x = <div style={{ opacity: 0.62 }} />;` },
    { code: `const x = <div style={{ flex: 1 }} />;` },
    { code: `const x = <div style={{ lineHeight: 1.3 }} />;` },
    // --- zero is dimensionless-safe ---
    { code: `const x = <div style={{ margin: 0, top: 0 }} />;` },
    // --- layout strings without a raw length/color ---
    { code: `const x = <div style={{ gridTemplateColumns: '1fr 2fr' }} />;` },
    { code: `const x = <div style={{ width: '100%' }} />;` },
    { code: `const x = <div style={{ aspectRatio: '1' }} />;` },
    // --- spread + computed key are ignored gracefully ---
    { code: `const x = <div style={{ ...base, left: pos }} />;` },
    // --- not an inline style object at all ---
    { code: `const config = { fontSize: 22, color: '#fff' };` },
  ],
  invalid: [
    // --- raw color literals ---
    { code: `const x = <div style={{ color: '#fff' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ color: '#B45309' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ color: 'rgba(255,255,255,0.55)' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ background: 'hsl(20, 30%, 50%)' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    // raw color inside a composite shadow value
    { code: `const x = <div style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.10)' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    // raw color inside a composite border value (no token)
    { code: `const x = <div style={{ border: '3px solid rgba(255,255,255,0.22)' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    // --- bare numeric dimensional literals ---
    { code: `const x = <div style={{ fontSize: 22 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ marginBottom: 24 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ padding: 16 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ gap: 14 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ borderRadius: 16 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ fontWeight: 600 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ width: 56, height: 56 }} />;`, errors: [{ messageId: 'staticLiteral' }, { messageId: 'staticLiteral' }] },
    // negative dimensional literal
    { code: `const x = <div style={{ marginLeft: -2 }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    // --- px/em/rem length strings (no token) ---
    { code: `const x = <div style={{ padding: '16px 20px' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    { code: `const x = <div style={{ letterSpacing: '-0.02em' }} />;`, errors: [{ messageId: 'staticLiteral' }] },
    // --- multiple offenders in one object → one report each ---
    {
      code: `const x = <div style={{ color: '#fff', fontSize: 14, background: 'var(--card)' }} />;`,
      errors: [{ messageId: 'staticLiteral' }, { messageId: 'staticLiteral' }],
    },
  ],
});
