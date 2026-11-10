import ts from 'typescript';

/**
 * Find the message keys source code passes to next-intl translators (#790).
 *
 * A translator is a variable bound to `useTranslations('ns')`, resolved
 * lexically: a nested function's parameter or local of the same name shadows
 * it, so a helper that receives some other namespace's `t` is not mistaken for
 * the enclosing component's. Calls through a translator whose namespace can't
 * be resolved are ignored.
 *
 * `t('key')`, `t.rich('key')`, `t.markup('key')` and `t.raw('key')` are checked,
 * and both branches of `t(cond ? 'a' : 'b')`. `t.has('key')` is a guard, so a
 * key it names may be missing on purpose. Any other argument is dynamic.
 */

export interface KeyUse {
    file: string;
    line: number;
    /** `namespace.key`, the full message path. */
    key: string;
}

export interface DynamicUse {
    file: string;
    line: number;
    namespace: string;
    expression: string;
}

const CHECKED_METHODS = new Set(['rich', 'markup', 'raw']);

function literalKeys(node: ts.Expression): string[] | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isParenthesizedExpression(node)) return literalKeys(node.expression);
    if (ts.isConditionalExpression(node)) {
        const a = literalKeys(node.whenTrue);
        const b = literalKeys(node.whenFalse);
        return a && b ? [...a, ...b] : null;
    }
    return null;
}

/** The namespace of `useTranslations('ns')`, or null when `node` isn't one. */
function translatorNamespace(node: ts.Expression | undefined): string | null {
    if (!node || !ts.isCallExpression(node)) return null;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== 'useTranslations') return null;
    const [arg] = node.arguments;
    return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

function bindingNames(name: ts.BindingName, out: string[]): void {
    if (ts.isIdentifier(name)) out.push(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, out);
}

export function scanTranslationKeys(file: string, source: string): { uses: KeyUse[]; dynamic: DynamicUse[] } {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const uses: KeyUse[] = [];
    const dynamic: DynamicUse[] = [];
    // Each scope maps a name to its namespace, or null when it's something else.
    const scopes: Map<string, string | null>[] = [new Map()];
    const lookup = (name: string): string | null => {
        for (let i = scopes.length - 1; i >= 0; i--) {
            if (scopes[i].has(name)) return scopes[i].get(name)!;
        }
        return null;
    };
    const declare = (name: string, ns: string | null) => scopes[scopes.length - 1].set(name, ns);
    const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const visit = (node: ts.Node): void => {
        const opensScope = ts.isFunctionLike(node) || ts.isBlock(node) || ts.isSourceFile(node) || ts.isCatchClause(node);
        if (opensScope && !ts.isSourceFile(node)) scopes.push(new Map());
        if (ts.isFunctionLike(node)) {
            for (const p of node.parameters) {
                const names: string[] = [];
                bindingNames(p.name, names);
                for (const n of names) declare(n, null);
            }
        }
        if (ts.isVariableDeclaration(node)) {
            const names: string[] = [];
            bindingNames(node.name, names);
            const ns = ts.isIdentifier(node.name) ? translatorNamespace(node.initializer) : null;
            for (const n of names) declare(n, ns);
        }
        if (ts.isCallExpression(node)) {
            let target: ts.Expression = node.expression;
            let method: string | null = null;
            if (ts.isPropertyAccessExpression(target)) {
                method = target.name.text;
                target = target.expression;
            }
            const ns = ts.isIdentifier(target) ? lookup(target.text) : null;
            if (ns !== null && (method === null || CHECKED_METHODS.has(method)) && node.arguments.length > 0) {
                const arg = node.arguments[0];
                const keys = literalKeys(arg);
                if (keys) for (const key of keys) uses.push({ file, line: lineOf(node), key: `${ns}.${key}` });
                else dynamic.push({ file, line: lineOf(node), namespace: ns, expression: arg.getText(sf) });
            }
        }
        ts.forEachChild(node, visit);
        if (opensScope && !ts.isSourceFile(node)) scopes.pop();
    };
    visit(sf);
    return { uses, dynamic };
}

/** True when `path` names a message (a string) in the catalog. */
export function hasMessage(catalog: unknown, path: string): boolean {
    let node: unknown = catalog;
    for (const part of path.split('.')) {
        if (!node || typeof node !== 'object' || !(part in (node as Record<string, unknown>))) return false;
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
}
