/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }));
vi.mock('next-intl', () => ({
    useLocale: () => 'en',
    useTranslations: () => Object.assign((key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key), { has: () => false, rich: (key: string) => key }),
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ activityTime: () => '2h', timestamp: (_: string, part?: string) => (part === 'time' ? '14:02' : '17 Oct 2026') }) }));
vi.mock('@/app/components/PersonPickerSheet', () => ({ PersonPickerSheet: () => null }));

import { MobileCases } from '@/app/cases/MobileCases';
import { MobileAudit } from '@/app/audit/MobileAudit';
import { SwitchRow } from '@/app/components/ui';
import type { CaseWithRelations, AuditLogEntryWithUser } from '@/lib/db/schema';

const kase = (Id: number, Status: string, extra: Partial<CaseWithRelations> = {}) => ({
    Id, Title: `Case ${Id}`, Status, UpdatedAt: '2026-10-17T10:00:00Z', Tags: ['Norway'], people: [{}], citations: [], comments: [],
    latestComment: { Kind: 'note', Body: 'A quoted note' }, ...extra,
}) as unknown as CaseWithRelations;

describe('MobileCases (#1122)', () => {
    const base = {
        treeId: 1, phase: 'ready' as const, loadError: null, onRetry: vi.fn(), canEdit: true, search: '', onSearch: vi.fn(),
        statusFilter: 'in_progress' as const, onStatus: vi.fn(), tagFilter: '', onTag: vi.fn(), tags: ['Norway'],
        counts: { inProgress: 1, onHold: 0, closed: 1 }, filtered: false, total: 2, onClearFilters: vi.fn(),
    };

    it('drops the last-note quote and the tags from a row', () => {
        render(<MobileCases {...base} visible={[kase(1, 'in_progress')]} closedRecent={[]} />);
        const row = screen.getByRole('link', { name: /Case 1/ });
        expect(row).toHaveAttribute('href', '/cases/view?id=1');
        expect(row).not.toHaveTextContent('A quoted note');
        expect(row).not.toHaveTextContent('Norway');
    });

    it('shows a closed case with its conclusion', () => {
        render(<MobileCases {...base} visible={[]} closedRecent={[kase(2, 'closed', { latestComment: { Kind: 'conclusion', Body: 'Died 1931' } as never })]} />);
        expect(screen.getByRole('link', { name: /Case 2/ })).toHaveTextContent('Died 1931');
    });

    it('gives viewers no New case pill', () => {
        render(<MobileCases {...base} canEdit={false} visible={[kase(1, 'in_progress')]} closedRecent={[]} />);
        expect(screen.queryByRole('button', { name: 'new_case' })).not.toBeInTheDocument();
    });
});

describe('MobileAudit (#1122)', () => {
    const entry = {
        Id: 9, EntityType: 'person', EntityId: 3, Action: 'update', EntityLabel: 'Person — Anders Halvorsen',
        CreatedAt: '2026-10-17T14:02:00Z', UserName: 'Ingrid', UserEmail: null, Changes: {},
    } as unknown as AuditLogEntryWithUser;
    const props = {
        loading: false, error: null, onRetry: vi.fn(), entries: [entry], total: 1, page: 1, pages: 1, onPage: vi.fn(),
        filters: { entityType: '', action: '', who: null, search: '', sort: 'when', dir: 'desc' as const },
        onPatch: vi.fn(), onSort: vi.fn(), editors: [], showWho: true, reverting: false, isRevertible: () => true,
        record: () => ({ name: 'Anders Halvorsen', node: () => 'Anders Halvorsen', href: '/people/view?id=3', gone: false }),
        changes: () => [{ key: 'BirthDate', label: 'Birth date', old: '1858', new: '14 Mar 1858' }], summary: () => null,
    };

    it('draws one summary line and puts Revert in the entry sheet, not the row', () => {
        render(<MobileAudit {...props} canEdit onRevert={vi.fn()} />);
        const row = screen.getByRole('button', { name: /Anders Halvorsen/ });
        expect(row).toHaveTextContent('Birth date');
        expect(row).toHaveTextContent('14 Mar 1858');
        expect(screen.queryByRole('button', { name: 'revert' })).not.toBeInTheDocument();
    });

    it('strikes the old value through instead of colouring it', () => {
        render(<MobileAudit {...props} canEdit onRevert={vi.fn()} />);
        const old = screen.getByText('1858');
        expect(old.tagName).toBe('S');
        expect(old.className).not.toContain('error');
    });
});

describe('SwitchRow (#1122)', () => {
    it('is a switch that toggles from anywhere on the row', () => {
        const onChange = vi.fn();
        render(<SwitchRow label="Status symbols" description="Shows †" checked={false} onChange={onChange} />);
        const sw = screen.getByRole('switch', { name: /Status symbols/ });
        expect(sw).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
    });
});
