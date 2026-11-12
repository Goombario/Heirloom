/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ActionLink } from '@/app/components/ui/ActionLink';
import { CoverBand } from '@/app/components/ui/CoverBand';
import { DetailBody } from '@/app/components/ui/DetailBody';
import { LeadText } from '@/app/components/ui/LeadText';
import { OpenInTreeRow } from '@/app/components/ui/OpenInTreeRow';
import { RecordMenu } from '@/app/components/ui/RecordMenu';

vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, onNavigate: _n, children, ...rest }: { href: string; onNavigate?: () => void; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('CoverBand (#55)', () => {
  it('renders the title as the page h1 on the hero island, with the actions slot', () => {
    wrap(<CoverBand eyebrow="Research case" title="Where did Anna live?" actions={<button type="button">Answer and close</button>} />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Where did Anna live?' });
    expect(h1.closest('.hero-dark')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Answer and close' })).toBeInTheDocument();
  });

  it('leaves the actions slot out when nothing is passed (Home, lists)', () => {
    const { container } = wrap(<CoverBand variant="short" title="People" meta="412 people" />);
    expect(container.querySelector('.cover-band__actions')).toBeNull();
    expect(container.querySelector('.cover-band--short')).not.toBeNull();
  });

  it('hangs the portrait and lead below the band only on the cover variant', () => {
    const { container, rerender } = wrap(<CoverBand title="Anna" portrait={<img alt="" />} lead={<p>Bio</p>} />);
    expect(container.querySelector('.cover--portrait .cover-portrait')).not.toBeNull();
    rerender(<NextIntlClientProvider locale="en" messages={en}><CoverBand variant="flat" title="Anna" portrait={<img alt="" />} /></NextIntlClientProvider>);
    expect(container.querySelector('.cover-portrait')).toBeNull();
  });
});

describe('ActionLink glyph rule (#55)', () => {
  it('defaults a link to ↗ and a plain button to no glyph', () => {
    wrap(<><ActionLink href="/audit">Full history</ActionLink><ActionLink onClick={() => {}}>Edit note</ActionLink></>);
    expect(screen.getByRole('link', { name: 'Full history' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Edit note' }).querySelector('svg')).toBeNull();
  });

  it('marks an expander with aria-expanded', () => {
    wrap(<ActionLink kind="expand" expanded onClick={() => {}}>Attach media</ActionLink>);
    expect(screen.getByRole('button', { name: 'Attach media' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('LeadText (#55)', () => {
  it('shows the Edit link and no Read all when the text fits', () => {
    const onEdit = vi.fn();
    wrap(<LeadText onEdit={onEdit} editLabel="Edit biography">Short.</LeadText>);
    expect(screen.queryByRole('button', { name: /Read all/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit biography' }));
    expect(onEdit).toHaveBeenCalled();
  });
});

describe('RecordMenu (#55)', () => {
  it('renders nothing for a viewer (no items)', () => {
    const { container } = wrap(<RecordMenu recordName="Anna" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a menu, keeps a disabled item inert, and runs an enabled one', () => {
    const del = vi.fn();
    const edit = vi.fn();
    wrap(<RecordMenu recordName="Hälleforsnäs" items={[
      { label: 'Rename or merge', onSelect: edit },
      { label: 'Delete place', onSelect: del, disabled: true, disabledReason: 'Only when no records use it. 112 do.' },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'More actions for Hälleforsnäs' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const disabled = screen.getByRole('menuitem', { name: /Delete place/ });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Only when no records use it. 112 do.')).toBeInTheDocument();
    fireEvent.click(disabled);
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename or merge' }));
    expect(edit).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('OpenInTreeRow (#55)', () => {
  it('links to the tree rooted at the person and says "Starts from"', () => {
    wrap(<OpenInTreeRow personId={42} firstName="Anna" />);
    const link = screen.getByRole('link', { name: /Open in tree/ });
    expect(link).toHaveAttribute('href', '/tree?rootId=42');
    expect(link).toHaveTextContent('Starts from Anna');
  });
});

describe('DetailBody (#55)', () => {
  it('renders the section index as a labelled nav and the rail as an aside', () => {
    wrap(
      <DetailBody index={[{ id: 's1', label: 'Life events' }]} rail={<p>Rail</p>}>
        <section id="s1">Main</section>
      </DetailBody>,
    );
    expect(screen.getByRole('navigation', { name: 'On this page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Life events' })).toHaveAttribute('href', '#s1');
    expect(screen.getByRole('complementary')).toHaveTextContent('Rail');
  });
});
