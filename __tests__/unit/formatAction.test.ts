import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import ru from '@/messages/ru.json';
import { formatAction, type FormatValue } from '@/app/components/home/formatAction';

type T = Parameters<typeof formatAction>[1];
const catalogs = { en, fr, ru } as Record<string, typeof en>;
const tr = (locale: string, namespace: 'home' | 'audit') =>
    createTranslator({ locale, messages: catalogs[locale], namespace }) as unknown as T;
const t = tr('en', 'home');
const tAudit = tr('en', 'audit');

// The audit log's formatting, reduced: dates as written, sex as a word.
const value: FormatValue = (s, raw) => (s.kind === 'sex' ? (raw === 'F' ? 'Female' : 'Male') : String(raw));
const edit = (fields: Record<string, { old: unknown; new: unknown }>) => ({ Action: 'update', EntityType: 'person', Changes: { fields } });
const say = (fields: Record<string, { old: unknown; new: unknown }>, person = { FirstName: 'Marie', LastName: 'Martin', Sex: 'F' }) =>
    formatAction(edit(fields), t, tAudit, { value, person });

describe('formatAction (#209)', () => {
    it('marks someone deceased or living', () => {
        expect(say({ IsDeceased: { old: false, new: true } })).toBe('Marked as deceased');
        expect(say({ IsDeceased: { old: true, new: false } })).toBe('Marked as living');
    });

    it('adds and changes a date', () => {
        expect(say({ BirthDate: { old: null, new: '12 MAR 1902' } })).toBe('Birth date added: 12 MAR 1902');
        expect(say({ BirthDate: { old: '1901', new: '12 MAR 1902' } })).toBe('Birth date changed to 12 MAR 1902');
    });

    it('says a field was removed', () => {
        expect(say({ BirthPlace: { old: 'Lyon', new: null } })).toBe('Birthplace removed');
        expect(say({ BirthDate: { old: '1901', new: '' } })).toBe('Birth date removed');
    });

    it('sets a text or place field', () => {
        expect(say({ BirthPlace: { old: null, new: 'Lyon' } })).toBe('Birthplace set to Lyon');
        expect(say({ DeathCause: { old: 'Fever', new: 'Typhus' } })).toBe('Cause of death set to Typhus');
    });

    it('gives the previous name on a rename', () => {
        expect(say({ LastName: { old: 'Dupont', new: 'Martin' } })).toBe('Renamed from Marie Dupont');
        expect(say({ FirstName: { old: 'Mary', new: 'Marie' }, LastName: { old: 'Dupond', new: 'Martin' } })).toBe('Renamed from Mary Dupond');
    });

    it('sets sex', () => {
        expect(say({ Sex: { old: 'M', new: 'F' } })).toBe('Sex set to Female');
    });

    it('says an opaque field was adjusted', () => {
        expect(say({ FocalX: { old: 0.2, new: 0.4 }, FocalY: { old: 0.2, new: 0.5 } })).toBe('Photo focus adjusted');
    });

    it('leads with the most meaningful of several changes', () => {
        expect(say({
            DeathDate: { old: null, new: '1950' },
            DeathPlace: { old: null, new: 'Paris' },
            IsDeceased: { old: false, new: true },
        })).toBe('Marked as deceased, +2 more');
        expect(say({ BirthPlace: { old: null, new: 'Lyon' }, BirthDate: { old: null, new: '1902' } })).toBe('Birth date added: 1902, +1 more');
    });

    it('falls back to the field list or "updated" for what it cannot phrase', () => {
        expect(formatAction(edit({ SomeInternalColumn: { old: 1, new: 2 } }), t, tAudit, { value })).toBe('updated');
        expect(say({ BirthPlace: { old: null, new: '' } })).toBe('Birthplace updated');
    });

    it('keeps the add and remove wording', () => {
        expect(formatAction({ Action: 'create', EntityType: 'person' }, t, tAudit)).toBe('added to tree');
    });

    it('has every phrase in fr and ru, with gendered wording', () => {
        for (const locale of ['fr', 'ru']) {
            const line = formatAction(edit({ IsDeceased: { old: false, new: true }, BirthDate: { old: null, new: '1902' } }),
                tr(locale, 'home'), tr(locale, 'audit'), { value, person: { Sex: 'F' } });
            expect(line).not.toMatch(/change_|\{/);
        }
        expect(formatAction(edit({ IsDeceased: { old: false, new: true } }), tr('fr', 'home'), tr('fr', 'audit'), { person: { Sex: 'F' } }))
            .toBe('Marquée comme décédée');
    });
});
