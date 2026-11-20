// Vitest 5 no longer extends Jest's global `jest.Matchers`, which is what
// `import '@testing-library/jest-dom'` augments, and jest-dom's own
// `@testing-library/jest-dom/vitest` types still target Vitest 4's one-parameter
// `Assertion`. Register the DOM matchers on Vitest 5's `Matchers<R, T>` here.
import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
