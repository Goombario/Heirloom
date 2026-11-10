/** @vitest-environment happy-dom */

import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

const messages: Record<string, string> = {
    born: 'b. <d>{date}</d>',
    born_at: 'b. <d>{date}</d>, {place}',
    died: 'd. <d>{date}</d>',
    died_at: 'd. <d>{date}</d>, {place}',
    born_year: 'b. {year}',
    died_year: 'd. {year}',
};
vi.mock('next-intl', () => {
    const fill = (key: string, values: Record<string, unknown> = {}) =>
        Object.entries(values).reduce((out, [k, v]) => (typeof v === 'string' || typeof v === 'number' ? out.replace(`{${k}}`, String(v)) : out), messages[key] ?? key);
    const t = Object.assign((key: string, values?: Record<string, unknown>) => fill(key, values), {
        rich: (key: string, values: Record<string, unknown> & { d: (c: React.ReactNode) => React.ReactNode }) => {
            const [before, rest = ''] = fill(key, values).split('<d>');
            const [inner, after = ''] = rest.split('</d>');
            return <>{before}{values.d(inner)}{after}</>;
        },
    });
    return { useTranslations: () => t };
});
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));

import { Lifespan } from '@/app/components/ui';
import { TreeCardLifespan } from '@/app/components/tree/TreeCardLifespan';

const text = (el: React.ReactElement) => render(el).container.textContent;

describe('Lifespan (#766)', () => {
    it('compact: years only, in mono', () => {
        const { container } = render(<Lifespan birth="1889-02-15" death="1960-02-20" />);
        expect(container.textContent).toBe('1889\u2009–\u20091960');
        expect(container.firstChild).toHaveClass('date-mono');
    });

    // #935, ADR 0034: amber for dates read as facts, muted for dates that identify.
    it('tone: compact defaults to muted, full to evidence, and either can be set', () => {
        expect(render(<Lifespan birth="1889" death="1960" />).container.firstChild).toHaveClass('date-muted');
        expect(render(<Lifespan birth="1889" death="1960" tone="evidence" />).container.firstChild).not.toHaveClass('date-muted');
        const full = render(<Lifespan variant="full" birth="1889-02-15" />).container;
        expect(full.querySelector('.date-mono')).not.toHaveClass('date-muted');
        const mutedFull = render(<Lifespan variant="full" birth="1889-02-15" tone="muted" />).container;
        expect(mutedFull.querySelector('.date-mono')).toHaveClass('date-muted');
    });

    it('compact: a living person with no death reads "b. 1895", never "–living" (#861)', () => {
        expect(text(<Lifespan birth="1895" status="living" />)).toBe('b. 1895');
        expect(text(<Lifespan birth="1895" status="deceased" />)).toBe('1895\u2009–\u2009?');
        expect(text(<Lifespan birth="1895" status="unknown" />)).toBe('b. 1895');
        expect(text(<Lifespan death="1960" />)).toBe('d. 1960');
    });

    it('compact: keeps a pre-formatted qualifier and renders nothing without dates', () => {
        expect(text(<Lifespan birth="~1876" preformatted />)).toBe('b. ~1876');
        expect(render(<Lifespan />).container).toBeEmptyDOMElement();
    });

    it('full: dated, with the first place segment, amber on the dates only', () => {
        const { container } = render(
            <Lifespan variant="full" birth="1889-02-15" death="1960-02-20" birthPlace="Lumen, Asteria" deathPlace="Sunvale" />,
        );
        expect(container.textContent).toBe('b. Feb 15, 1889, Lumen — d. Feb 20, 1960, Sunvale');
        expect([...container.querySelectorAll('.date-mono')].map((n) => n.textContent)).toEqual(['Feb 15, 1889', 'Feb 20, 1960']);
    });

    it('full: one side alone, and nothing when both are missing', () => {
        expect(text(<Lifespan variant="full" death="1960-02-20" />)).toBe('d. Feb 20, 1960');
        expect(render(<Lifespan variant="full" />).container).toBeEmptyDOMElement();
    });
});

// Tree cards used to print the server's "1712 - 1727" outside Lifespan (#808, DV-1).
describe('TreeCardLifespan (#808)', () => {
    it('renders the tree service years through Lifespan, with an en dash', () => {
        expect(text(<TreeCardLifespan lifespan={{ birth: '1712', death: '1727', deceased: true }} />)).toBe('1712\u2009–\u20091727');
        expect(text(<TreeCardLifespan lifespan={{ birth: '~1876', death: null, deceased: true }} />)).toBe('~1876\u2009–\u2009?');
        expect(text(<TreeCardLifespan lifespan={{ birth: '1954', death: null, deceased: false }} />)).toBe('b. 1954');
        // Tree cards are muted in both layouts (#935).
        expect(render(<TreeCardLifespan lifespan={{ birth: '1712', death: '1727', deceased: true }} />).container.querySelector('.date-mono.date-muted')).not.toBeNull();
    });
});
