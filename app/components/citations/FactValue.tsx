import type { CitationFactDescriptor } from './types';

/** A citation fact's value with its date in the mono date treatment (#731). */
export default function FactValue({ fact }: { fact: Pick<CitationFactDescriptor, 'value' | 'date' | 'detail'> }) {
  if (!fact.date) return <>{fact.value}</>;
  return (
    <>
      <span className="date-mono">{fact.date}</span>
      {fact.detail ? ` · ${fact.detail}` : null}
    </>
  );
}
