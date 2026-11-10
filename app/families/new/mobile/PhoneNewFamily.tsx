'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FamiliesPageClient from '../../FamiliesPageClient';
import { NewFamilySheet, afterSheetStep } from './NewFamilySheet';

/**
 * `/families/new` on a phone: the families list with the New family sheet open over
 * it (#1066). Closing goes back to where the user came from; saving opens the new
 * family in this entry's place, so Back doesn't return to a spent form.
 */
export function PhoneNewFamily() {
    const router = useRouter();
    const [open, setOpen] = useState(true);
    return (
        <>
            <FamiliesPageClient initialFamilies={null} />
            <NewFamilySheet
                open={open}
                onClose={() => {
                    setOpen(false);
                    afterSheetStep(() => {
                        if (window.history.length > 1) router.back();
                        else router.replace('/families');
                    });
                }}
                onCreated={(id) => {
                    setOpen(false);
                    afterSheetStep(() => router.replace(`/families/view?id=${id}`));
                }}
            />
        </>
    );
}
