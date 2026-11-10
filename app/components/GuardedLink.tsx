'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useUnsavedChangesGuard } from './UnsavedChangesProvider';

type GuardedLinkProps = ComponentProps<typeof Link>;

/** A normal Next link that consults the active dirty-form registrations. */
export default function GuardedLink({ onNavigate, ...props }: GuardedLinkProps) {
    const { onNavigate: guard } = useUnsavedChangesGuard(false);
    return (
        <Link
            {...props}
            onNavigate={(event) => {
                if (guard(event)) onNavigate?.(event);
            }}
        />
    );
}
