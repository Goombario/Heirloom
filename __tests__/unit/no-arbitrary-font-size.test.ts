import { RuleTester } from 'eslint';
import { describe, it, afterAll } from 'vitest';
import rule from '../../eslint-rules/no-arbitrary-font-size.mjs';

// Wire ESLint's RuleTester into vitest's globals (see no-inline-static-literal.test.ts).
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

ruleTester.run('no-arbitrary-font-size', rule, {
  valid: [
    { code: `const x = <div className="text-meta text-text-muted" />;` },
    { code: `const x = <div className="text-sm md:text-base" />;` },
    // Arbitrary colours and non-px values are other rules' business.
    { code: `const x = <div className="text-[color:var(--text)]" />;` },
    { code: `const x = <div className="text-[var(--size)]" />;` },
    { code: `const x = <div className="max-w-[12px] leading-[12px]" />;` },
    { code: `const note = 'context-[12px]';` },
  ],
  invalid: [
    { code: `const x = <div className="text-[12px]" />;`, errors: [{ messageId: 'arbitrarySize' }] },
    { code: `const x = <div className="muted text-[12.5px]" />;`, errors: [{ messageId: 'arbitrarySize' }] },
    { code: `const x = <div className="md:text-[15px]" />;`, errors: [{ messageId: 'arbitrarySize' }] },
    { code: `const x = <div className="!text-[10px]" />;`, errors: [{ messageId: 'arbitrarySize' }] },
    { code: `const cls = cx('row', active && 'text-[.5px]');`, errors: [{ messageId: 'arbitrarySize' }] },
    { code: 'const x = <div className={`row ${a} text-[13px]`} />;', errors: [{ messageId: 'arbitrarySize' }] },
  ],
});
