export function extractCssClassSelectors(css: string): string[];
export function isClassReferenced(className: string, corpus: string): boolean;
export function rankOversized(
  files: { file: string; lines: number }[],
  threshold: number
): { file: string; lines: number }[];
export function diffKnip(baselineKeys: string[], currentKeys: string[]): string[];
export function knipIssueKeys(report: { issues?: Array<Record<string, unknown>> }): string[];
