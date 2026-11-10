/**
 * ds/no-inline-static-literal
 *
 * Flags STATIC, tokenizable literals inside inline `style={{}}` objects — the
 * hand-rolled sprawl the design-system cleanup targets (#175). It deliberately
 * ALLOWS computed/dynamic values (positions, canvas coords, `calc(env(...))`,
 * prop/state-derived expressions), which are legitimate and must not be flagged.
 *
 * Flagged:
 *   - raw color literals: `#hex`, `rgb()/rgba()`, `hsl()/hsla()` (with no `var(`)
 *   - raw length strings on any prop: `'16px 20px'`, `'-0.02em'` (with no var/calc/env)
 *   - bare numeric literals on dimensional/type props: `fontSize: 22`, `gap: 14`,
 *     `borderRadius: 16`, `fontWeight: 600`, `marginLeft: -2`
 *
 * Allowed (never flagged):
 *   - any string containing `var()`, `calc()`, `env()`, `min()`, `max()`, `clamp()`
 *   - non-Literal values: Identifier, MemberExpression, ConditionalExpression,
 *     TemplateLiteral, CallExpression, … (i.e. anything computed)
 *   - `0` (dimensionless-safe), and numerics on non-dimensional props
 *     (`zIndex`, `opacity`, `flex`, `lineHeight`, `aspectRatio`, …)
 */

const DIMENSIONAL_PROPS = new Set([
  'fontSize', 'fontWeight', 'letterSpacing',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingInline', 'paddingBlock',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginInline', 'marginBlock',
  'gap', 'rowGap', 'columnGap',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'top', 'right', 'bottom', 'left',
  'borderRadius', 'borderWidth',
]);

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/;
const LENGTH_RE = /-?\d*\.?\d+(?:px|em|rem)\b/;
const DYNAMIC_RE = /\b(?:var|calc|env|min|max|clamp)\s*\(/;

function propName(key, computed) {
  if (computed || !key) return undefined;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return undefined;
}

/** Number for `22` and unary `-2`/`+2`; undefined for non-numeric-literal nodes. */
function numericLiteralValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (
    node.type === 'UnaryExpression' &&
    (node.operator === '-' || node.operator === '+') &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number'
  ) {
    return node.operator === '-' ? -node.argument.value : node.argument.value;
  }
  return undefined;
}

/** Returns the offending kind ('color' | 'length' | 'number') or null if allowed. */
function classify(name, valueNode) {
  if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
    const v = valueNode.value;
    if (DYNAMIC_RE.test(v)) return null; // uses a token / computed function → allowed
    if (COLOR_RE.test(v)) return 'color';
    if (LENGTH_RE.test(v)) return 'length';
    return null;
  }
  const num = numericLiteralValue(valueNode);
  if (num !== undefined) {
    if (num === 0) return null; // zero is dimensionless-safe
    if (name && DIMENSIONAL_PROPS.has(name)) return 'number';
    return null;
  }
  return null; // Identifier / MemberExpression / Conditional / Template / Call → computed
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow new static, tokenizable literals inside inline style objects (design-system cleanup #175); computed/dynamic values are allowed.',
    },
    messages: {
      staticLiteral:
        "Static {{kind}} literal in inline style ({{prop}}) — use a design-system token/utility class or a var()/computed value. New static inline-style literals are blocked (design-system cleanup #175); see design-system.md.",
    },
    schema: [],
  },
  create(context) {
    return {
      // Direct-child selector: matches the literal `style={{ … }}` form only.
      // Style objects wrapped in a conditional/logical expression
      // (`style={cond ? { … } : …}`) are intentionally NOT matched — a precise
      // selector keeps this CI-blocking rule free of false positives (e.g. object
      // literals passed as function args inside a style expression). This is a
      // known coverage gap for the ratchet, acceptable because the wrapped form
      // is rare and its static literals are still caught if later inlined.
      "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression"(node) {
        for (const prop of node.properties) {
          if (prop.type !== 'Property') continue; // skip SpreadElement
          const name = propName(prop.key, prop.computed);
          const kind = classify(name, prop.value);
          if (kind) {
            context.report({
              node: prop.value,
              messageId: 'staticLiteral',
              data: { kind, prop: name ?? 'style' },
            });
          }
        }
      },
    };
  },
};

export default rule;
