'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTree } from '@/app/contexts/TreeContext';
import { useIsMobile } from '@/app/hooks/useIsMobile';

// Loaded on first use, so the forms stay out of every page's first bundle.
const AddPersonDialog = dynamic(() => import('@/app/people/AddPersonDialog').then((m) => m.AddPersonDialog), { ssr: false });
const AddPersonSheet = dynamic(() => import('@/app/people/AddPersonSheet').then((m) => m.AddPersonSheet), { ssr: false });
const NewFamilyDialog = dynamic(() => import('@/app/families/NewFamilyDialog').then((m) => m.NewFamilyDialog), { ssr: false });
const NewFamilySheet = dynamic(() => import('@/app/families/new/mobile/NewFamilySheet').then((m) => m.NewFamilySheet), { ssr: false });

export type QuickAddKind = 'person' | 'family';

const OPEN_EVENT = 'heirloom:quick-add';

/**
 * Opens New person or New family over whatever page is showing: the quick-add
 * dialog on a wider screen, the sheet on a phone. Saving opens the new record,
 * as it does from the lists.
 */
export function openQuickAdd(kind: QuickAddKind) {
    window.dispatchEvent(new CustomEvent<QuickAddKind>(OPEN_EVENT, { detail: kind }));
}

/**
 * The one place the New person and New family forms mount outside their lists,
 * rendered once in the root layout. `openQuickAdd` asks it to open one.
 */
export default function QuickAddHost() {
    const { activeTreeId, activePermission } = useTree();
    const canEdit = activePermission != null && activePermission !== 'view';
    const phone = useIsMobile();
    const router = useRouter();
    const [open, setOpen] = useState<QuickAddKind | null>(null);
    // A form mounts the first time it is asked for and stays, so a sheet can animate shut.
    const [used, setUsed] = useState<{ person: boolean; family: boolean }>({ person: false, family: false });

    useEffect(() => {
        const onOpen = (e: Event) => {
            const kind = (e as CustomEvent<QuickAddKind>).detail;
            setUsed((u) => (u[kind] ? u : { ...u, [kind]: true }));
            setOpen(kind);
        };
        window.addEventListener(OPEN_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_EVENT, onOpen);
    }, []);

    // "Save and open" navigates to the new record; the form closes with the page it
    // was opened over, as it does when a list page unmounts it.
    const pathname = usePathname();
    const search = useSearchParams().toString();
    const [at, setAt] = useState(`${pathname}?${search}`);
    if (at !== `${pathname}?${search}`) {
        setAt(`${pathname}?${search}`);
        if (open) setOpen(null);
    }

    if (!canEdit) return null;
    const close = () => setOpen(null);
    const openFamily = (id: number) => {
        setOpen(null);
        router.push(`/families/view?id=${id}`);
    };

    return (
        <>
            {used.person && (phone
                ? <AddPersonSheet open={open === 'person'} onClose={close} treeId={activeTreeId} />
                : <AddPersonDialog open={open === 'person'} onClose={close} treeId={activeTreeId} />)}
            {used.family && (phone
                ? <NewFamilySheet open={open === 'family'} onClose={close} onCreated={(id) => {
                    setOpen(null);
                    // The sheet steps back through history as it closes; open the family after.
                    void import('@/app/families/new/mobile/NewFamilySheet').then((m) => m.afterSheetStep(() => router.push(`/families/view?id=${id}`)));
                }} />
                : <NewFamilyDialog open={open === 'family'} onClose={close} onCreated={openFamily} />)}
        </>
    );
}
