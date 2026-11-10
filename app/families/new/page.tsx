'use client';

import FamilyForm from '@/app/components/FamilyForm';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { PhoneNewFamily } from './mobile/PhoneNewFamily';

export default function NewFamilyPage() {
    // Phones get the New family sheet over the families list (#1066); desktop keeps the form.
    const isMobile = useIsMobile();
    return isMobile ? <PhoneNewFamily /> : <FamilyForm mode="new" />;
}
