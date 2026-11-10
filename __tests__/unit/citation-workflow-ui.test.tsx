/** @vitest-environment happy-dom */
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SourcesCitedCard from '@/app/components/SourcesCitedCard';
import CitationDrawer from '@/app/components/CitationDrawer';
import CitationPreview from '@/app/components/citations/CitationPreview';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import type { CitationFactDescriptor } from '@/app/components/citations/types';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const phone = vi.hoisted(() => ({ on: false }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => phone.on }));
vi.mock('@/app/components/AttachSourceSidebar', () => ({
  default: ({ canDetach }: { canDetach?: boolean }) => <div data-testid="fact-citation-editor" data-can-detach={String(canDetach)} />,
}));

const onClose = vi.fn();
const fact: CitationFactDescriptor = {
  factTable: FACT_TABLES.PERSON_BIRTH,
  factId: 7,
  label: 'Birth',
  value: '12 March 1874',
  citations: [{
    Id: 5, OwnerId: 1, FactTable: FACT_TABLES.PERSON_BIRTH, FactId: 7, SourceId: 10,
    Page: 'p. 4', Note: null, Quay: '3', DataText: 'Born on the twelfth', DataDate: null,
    Even: null, Role: null, CreatedAt: '2026-01-01', sourceTitle: 'Civil register', sourceType: 'Vital', sourceRepo: 'Archives',
  }],
};

beforeEach(() => vi.clearAllMocks());

describe('citation workflow UI', () => {
  it('lists each source once as a linked footnote, with no owner-wide action (#780)', () => {
    const death = { ...fact, factTable: FACT_TABLES.PERSON_DEATH, label: 'Death', citations: [{ ...fact.citations[0], Id: 6 }] };
    render(<SourcesCitedCard facts={[fact, death]} title="Sources cited" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('1Civil register');
    expect(links[0].getAttribute('href')).toBe('/library?tab=sources&source=10');
    expect(screen.queryByText(/Birth|Death/)).toBeNull();
    expect(screen.queryByRole('button', { name: /all_citations/ })).toBeNull();
  });

  it('renders nothing until the page cites something (#904)', () => {
    const { container } = render(<SourcesCitedCard facts={[{ ...fact, citations: [] }]} title="Sources cited" />);
    expect(container.firstChild).toBeNull();
  });

  it('numbers the rail chips as page-local footnotes, not source IDs (#754)', () => {
    const second = { ...fact.citations[0], Id: 6, SourceId: 317, sourceTitle: 'Parish register' };
    const death = { ...fact, factTable: FACT_TABLES.PERSON_DEATH, label: 'Death', citations: [second, { ...fact.citations[0], Id: 7 }] };
    render(<SourcesCitedCard facts={[fact, death]} title="Sources cited" />);
    expect(screen.getAllByRole('link').map(l => l.textContent)).toEqual(['1Civil register', '2Parish register']);
  });

  it('keeps detach out of the contributor editor', () => {
    render(<CitationDrawer title="Ada Lovelace" fact={fact} canDetach={false} initialCitationId={5} onClose={onClose} />);
    expect(screen.getByTestId('fact-citation-editor').getAttribute('data-can-detach')).toBe('false');
  });

  it('previews the clicked citation and offers edit only to editors', () => {
    const anchor = document.createElement('span');
    document.body.appendChild(anchor);
    const onEdit = vi.fn();
    const { rerender } = render(<CitationPreview target={{ fact, citation: fact.citations[0], anchor }} sourceNumbers={new Map([[10, 1]])} canEdit onClose={onClose} onEdit={onEdit} />);
    expect(screen.getByText('12 March 1874')).toBeTruthy();
    expect(screen.getByText('evidence_for')).toBeTruthy();
    expect(screen.getByText('certainty_short_3')).toBeTruthy();
    const previewCard = screen.getByTestId('citation-preview-card');
    expect(previewCard.classList.contains('max-w-[480px]')).toBe(true);
    expect(previewCard.classList.contains('rounded-panel')).toBe(true);
    expect(previewCard.classList.contains('shadow-[var(--shadow-lg)]')).toBe(true);
    expect(screen.getByText('12 March 1874').classList.contains('truncate')).toBe(false);
    expect(screen.getByText('Civil register').classList.contains('truncate')).toBe(false);
    const transcription = screen.getByText('Born on the twelfth').closest('blockquote');
    expect(transcription?.classList.contains('bg-card-alt')).toBe(true);
    expect(transcription?.classList.contains('border-evidence-border')).toBe(true);
    expect(screen.queryByText('field_transcription')).toBeNull();
    expect(screen.queryByText('citation_detail')).toBeNull();
    expect(screen.getByRole('link', { name: 'open_source' }).getAttribute('title')).toBe('open_in_library');
    fireEvent.click(screen.getByRole('button', { name: 'edit_citation' }));
    expect(onEdit).toHaveBeenCalledWith(fact.citations[0]);

    rerender(<CitationPreview target={{ fact, citation: fact.citations[0], anchor }} sourceNumbers={new Map([[10, 1]])} canEdit={false} onClose={onClose} onEdit={onEdit} />);
    expect(screen.queryByRole('button', { name: 'edit_citation' })).toBeNull();
    anchor.remove();
  });

  it('lists every citation on the fact, whichever chip opened it (#756)', () => {
    const anchor = document.createElement('span');
    document.body.appendChild(anchor);
    const onEdit = vi.fn();
    const parish = { ...fact.citations[0], Id: 6, SourceId: 11, sourceTitle: 'Parish register', Quay: null, DataText: null };
    const census = { ...fact.citations[0], Id: 7, SourceId: 12, sourceTitle: 'Census', Quay: null, DataText: null };
    const numbers = new Map([[10, 1], [11, 2], [12, 3]]);
    render(<CitationPreview target={{ fact: { ...fact, citations: [census, fact.citations[0], parish] }, citation: parish, anchor }} sourceNumbers={numbers} canEdit onClose={onClose} onEdit={onEdit} />);

    expect(screen.getAllByRole('listitem').map(li => li.textContent?.slice(0, 1))).toEqual(['1', '2', '3']);
    expect(screen.getAllByRole('button', { name: 'edit_citation' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'edit_citation' })[2]);
    expect(onEdit).toHaveBeenCalledWith(census);
    expect(document.activeElement?.closest('li')?.textContent).toContain('Parish register');
    anchor.remove();
  });
});

/** A fact's chip that opens the popover, the way a timeline row does. */
function ChipWithPreview() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" onClick={(e) => setAnchor(e.currentTarget)}>chip</button>
      {anchor && <CitationPreview target={{ fact, citation: fact.citations[0], anchor }} sourceNumbers={new Map([[10, 1]])} canEdit onClose={() => setAnchor(null)} onEdit={vi.fn()} />}
      <button type="button">next on the page</button>
    </>
  );
}

describe('citation popover Tab-out (#798, KB-4, #844)', () => {
  const open = async () => {
    const user = userEvent.setup();
    render(<ChipWithPreview />);
    await user.click(screen.getByRole('button', { name: 'chip' }));
    expect(screen.getByRole('link', { name: 'open_source' })).toHaveFocus();
    return user;
  };
  const card = () => screen.queryByTestId('citation-preview-card');

  it('Tabs between its own controls without closing', async () => {
    const user = await open();
    await user.tab();
    expect(screen.getByRole('button', { name: 'edit_citation' })).toHaveFocus();
    expect(card()).not.toBeNull();
  });

  it('closes on Tab past the last control and returns focus to the chip', async () => {
    const user = await open();
    await user.tab();
    await user.tab();
    expect(card()).toBeNull();
    expect(screen.getByRole('button', { name: 'chip' })).toHaveFocus();
  });

  it('on a phone, moves focus into the sheet, keeps Tab there, and Escape returns to the chip', async () => {
    phone.on = true;
    try {
      const user = userEvent.setup();
      render(<ChipWithPreview />);
      await user.click(screen.getByRole('button', { name: 'chip' }));
      const sheet = await screen.findByRole('dialog');
      await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
      for (let i = 0; i < 4; i++) {
        await user.tab();
        expect(sheet.contains(document.activeElement)).toBe(true);
      }
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('button', { name: 'chip' })).toHaveFocus();
    } finally {
      phone.on = false;
    }
  });

  it('closes on Shift+Tab before the first control and returns focus to the chip', async () => {
    const user = await open();
    await user.tab({ shift: true });
    expect(card()).toBeNull();
    expect(screen.getByRole('button', { name: 'chip' })).toHaveFocus();
  });
});
