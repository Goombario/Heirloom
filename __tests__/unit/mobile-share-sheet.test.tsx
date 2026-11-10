/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

import { MobileShareSheet } from '@/app/components/share/MobileShareSheet';

const props = {
    open: true, onClose: vi.fn(), treeName: 'Halvorsen family', owner: { name: 'Ingrid', email: 'g@example.com' },
    members: [{ id: 's4', name: 'Marit', email: 'marit@example.com', role: 'edit' as const }],
    error: null, busy: false, revokingId: null, onRole: vi.fn(), onRevoke: vi.fn().mockResolvedValue(undefined),
};

describe('MobileShareSheet (#1125)', () => {
    it('keeps Invite off until the email looks valid, then invites with the chosen role', async () => {
        const onInvite = vi.fn().mockResolvedValue(true);
        render(<MobileShareSheet {...props} onInvite={onInvite} />);
        const invite = screen.getByRole('button', { name: 'invite_button' });
        expect(invite).toBeDisabled();
        fireEvent.change(screen.getByLabelText('email_label'), { target: { value: 'ingrid@example.com' } });
        expect(invite).toBeEnabled();
        expect(screen.getByText('role_view_desc')).toBeInTheDocument();
        fireEvent.click(invite);
        await waitFor(() => expect(onInvite).toHaveBeenCalledWith('ingrid@example.com', 'view'));
    });

    it('lists the owner first, then members with their role word', () => {
        render(<MobileShareSheet {...props} onInvite={vi.fn()} />);
        expect(screen.getByText('owner_you')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Marit/ })).toHaveTextContent('permission_edit');
    });

    it('removes access only through the confirm card', async () => {
        render(<MobileShareSheet {...props} onInvite={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Marit/ }));
        fireEvent.click(await screen.findByRole('button', { name: /remove_access/ }));
        expect(props.onRevoke).not.toHaveBeenCalled();
        const confirm = await screen.findAllByRole('button', { name: 'remove_access' });
        fireEvent.click(confirm[confirm.length - 1]);
        await waitFor(() => expect(props.onRevoke).toHaveBeenCalledWith('s4'));
    });

    it('marks a pending share as waiting for a first sign-in (#1228)', () => {
        const members = [...props.members, { id: 'p2', name: 'olaf@example.com', email: 'olaf@example.com', role: 'view' as const, pending: true }];
        render(<MobileShareSheet {...props} members={members} onInvite={vi.fn()} />);
        expect(screen.getByRole('button', { name: /olaf@example\.com/ })).toHaveTextContent('pending_sub');
        expect(screen.getByRole('button', { name: /Marit/ })).not.toHaveTextContent('pending_sub');
    });
});
