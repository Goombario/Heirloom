// The date control moved to ./date-input/ when it became a composite (select +
// date boxes + phrase mode). This re-export keeps the six existing call sites,
// and the `@/app/components/DateInput` import path, unchanged.
export { default } from './date-input/DateInput';
