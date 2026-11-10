/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { CaseStatus } from '@/app/cases/CaseStatus';

// One status look everywhere (#767, CL-2): a dot and a word, never a boxed tag.
describe('CaseStatus', () => {
    it('renders in progress as a green dot and word with no fill', () => {
        render(<CaseStatus status="in_progress" />);
        const status = screen.getByText('status_in_progress');
        expect(status).toHaveClass('text-success');
        expect(status.className).not.toMatch(/\bbg-/);
        expect(status.querySelector('[aria-hidden="true"]')).toHaveClass('rounded-full', 'bg-current');
    });

    it('keeps on hold and closed neutral, and shows an unknown status as data', () => {
        render(<><CaseStatus status="on_hold" /><CaseStatus status="closed" /><CaseStatus status="archived" /></>);
        expect(screen.getByText('status_on_hold')).toHaveClass('text-text-muted');
        expect(screen.getByText('status_closed')).toHaveClass('text-text-muted');
        expect(screen.getByText('archived')).toHaveClass('text-text-muted');
    });
});
