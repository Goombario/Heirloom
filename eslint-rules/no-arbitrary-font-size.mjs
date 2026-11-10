/**
 * ds/no-arbitrary-font-size
 *
 * Flags arbitrary pixel font-size utilities (`text-[12px]`, `md:text-[12.5px]`,
 * `!text-[15px]`) in any string or template literal — class names reach JSX
 * through `className`, `cx()`, lookup tables and constants alike, so the rule
 * matches the class text wherever it appears. Use the type ramp instead
 * (#687): `text-xs` 11, `text-meta` 12, `text-sm` 13, `text-base` 14, `text-md`
 * 16, `text-lg` 18, `text-xl` 22, `text-2xl` 28, `text-3xl` 32, `text-4xl` 40.
 *
 * Numeric inline `fontSize` in `style={{}}` is already covered by
 * `ds/no-inline-static-literal`. Pre-existing violations are baselined in
 * `eslint-suppressions.json` (baseline and shrink).
 */

const ARBITRARY_SIZE_RE = /(?:^|[\s:!"'`])text-\[\d*\.?\d+px\]/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow new arbitrary pixel font-size utilities; use the type-ramp tokens (#687).',
    },
    messages: {
      arbitrarySize:
        'Arbitrary font size `{{match}}` — use a type-ramp utility (text-xs/meta/sm/base/md/lg/xl/2xl/3xl/4xl). New `text-[Npx]` classes are blocked (#687); see design-system.md.',
    },
    schema: [],
  },
  create(context) {
    function check(node, text) {
      const m = ARBITRARY_SIZE_RE.exec(text);
      if (m) {
        context.report({ node, messageId: 'arbitrarySize', data: { match: m[0].replace(/^[\s:!"'`]/, '') } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

export default rule;
