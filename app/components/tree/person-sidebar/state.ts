import type { PersonWithRelations } from '@/lib/db/schema';

export interface SidebarForm {
    FirstName: string;
    LastName: string;
    Sex: string | null;
    BirthDate: string;
    BirthPlace: string;
    DeathDate: string;
    DeathPlace: string;
    IsDeceased: number | null;
}

export const emptySidebarForm: SidebarForm = {
    FirstName: '',
    LastName: '',
    Sex: '' as string | null,
    BirthDate: '',
    BirthPlace: '',
    DeathDate: '',
    DeathPlace: '',
    IsDeceased: null,
};

/** Map a loaded person to the editable sidebar form (null strings → ''). */
export function personToForm(p: PersonWithRelations): SidebarForm {
    return {
        FirstName: p.FirstName || '',
        LastName: p.LastName || '',
        Sex: p.Sex || null,
        BirthDate: p.BirthDate || '',
        BirthPlace: p.BirthPlace || '',
        DeathDate: p.DeathDate || '',
        DeathPlace: p.DeathPlace || '',
        IsDeceased: p.IsDeceased,
    };
}

// The sidebar's notes are first-class Note + NoteLink rows rendered by
// OwnerNotesCard, which writes them itself — so notes are neither part of this
// form nor of the person update body (#524 / ADR 0010).
export interface PersonUpdateBody {
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    DeathDate: string | null;
    DeathPlace: string | null;
    IsDeceased: number | null;
}

/** Build the people.update body from the form (empty strings → null). */
export function buildPersonUpdate(form: SidebarForm): PersonUpdateBody {
    return {
        FirstName: form.FirstName || null,
        LastName: form.LastName || null,
        Sex: form.Sex,
        BirthDate: form.BirthDate || null,
        BirthPlace: form.BirthPlace || null,
        DeathDate: form.DeathDate || null,
        DeathPlace: form.DeathPlace || null,
        IsDeceased: form.IsDeceased,
    };
}

export function computeInitials(first: string | null, last: string | null): string {
    return [first, last]
        .filter(Boolean)
        .map((n) => n!.charAt(0))
        .join('')
        .toUpperCase() || '?';
}

export function computeDisplayName(first: string | null, last: string | null, fallback: string): string {
    return [first, last].filter(Boolean).join(' ') || fallback;
}

export function isFormDirty(form: SidebarForm, original: SidebarForm): boolean {
    return (Object.keys(form) as (keyof SidebarForm)[]).some(k => form[k] !== original[k]);
}

/** Toggle living status — clears death fields whenever the person is not deceased. */
export function applyDeceasedChange(form: SidebarForm, value: number | null): SidebarForm {
    const next = { ...form, IsDeceased: value };
    if (value !== 1) {
        next.DeathDate = '';
        next.DeathPlace = '';
    }
    return next;
}
