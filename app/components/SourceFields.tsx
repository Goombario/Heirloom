'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Input, fieldClass } from '@/app/components/ui/Input';
import { Card } from '@/app/components/ui/Card';
import { SelectField } from '@/app/components/ui/Select';
import { RepositoryPicker } from '@/app/components/RepositoryPicker';

const SOURCE_TYPES = ['Census', 'Vital', 'Church', 'Newspaper', 'Oral', 'Document', 'Photo', 'Other'] as const;

export interface SourceFormState {
    Title: string;
    /** GEDCOM `1 ABBR` — the short filing form of Title, used for sorting (#501). */
    Abbreviation: string;
    Type: string;
    Author: string;
    RepositoryName: string;
    CallNumber: string;
    Text: string; // the source's own website (#1019)
    PublicationInfo: string;
    Contents: string; // the source's text, for every type (#470)
}

export const emptySourceForm: SourceFormState = {
    Title: '',
    Abbreviation: '',
    Type: 'Document',
    Author: '',
    RepositoryName: '',
    CallNumber: '',
    Text: '',
    PublicationInfo: '',
    Contents: '',
};

// Field chrome for the type select and <textarea> — the same ui/Input utility strings
const SELECT_FIELD = fieldClass();
const SELECT_FIELD_SM = fieldClass('sm');

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="mb-[22px]">
            <div className="mb-[10px]">
                <h2 className="section serif text-md" style={{ margin: 0 }}>{title}</h2>
                {hint && <p className="muted text-meta mt-[2px]" style={{ marginBottom: 0 }}>{hint}</p>}
            </div>
            <Card>{children}</Card>
        </div>
    );
}

export interface SourceFieldsProps {
    value: SourceFormState;
    onChange: (patch: Partial<SourceFormState>) => void;
    disabled?: boolean;
    idPrefix?: string;
    /** The tree whose repositories the Repository picker offers; `null` is the user's own tree. */
    treeId: number | null;
    /** Compact single-column mode for narrow contexts (e.g. sidebar). Omits Section/Card
     *  chrome, collapses 2-column grids to single column, uses sm input sizing and short
     *  placeholder copy. Does NOT autofocus Title. */
    compact?: boolean;
    /** A record site's repository, offered as the picker's Automatic option (#1029). */
    automaticRepository?: string;
}

export function SourceFields({ value, onChange, disabled = false, idPrefix = 'sf', treeId, compact = false, automaticRepository }: SourceFieldsProps) {
    const t = useTranslations('library');
    const pid = (name: string) => `${idPrefix}-${name}`;

    const onInput = (key: keyof SourceFormState) =>
        (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [key]: e.target.value } as Partial<SourceFormState>);

    const onTextArea = (key: keyof SourceFormState) =>
        (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ [key]: e.target.value } as Partial<SourceFormState>);

    if (compact) {
        return (
            <div className="gap-[10px]" style={{ display: 'flex', flexDirection: 'column' }}>
                <Input
                    id={pid('title')}
                    size="sm"
                    label={
                        <>
                            {t('field_title_label')}
                            <span className="ml-[3px]" style={{ color: 'var(--error)' }}>*</span>
                        </>
                    }
                    placeholder={t('ph_title_short')}
                    value={value.Title}
                    onChange={onInput('Title')}
                    disabled={disabled}
                />
                <Input
                    id={pid('abbreviation')}
                    size="sm"
                    label={t('field_abbreviation')}
                    placeholder={t('ph_abbreviation_short')}
                    value={value.Abbreviation}
                    onChange={onInput('Abbreviation')}
                    disabled={disabled}
                />
                <label className="block">
                    <span className="block text-sm font-medium text-text-secondary mb-1.5">
                        {t('field_type')}
                    </span>
                    <SelectField
                        id={pid('type')}
                        fieldClassName={SELECT_FIELD_SM}
                        value={value.Type}
                        onChange={(type) => onChange({ Type: type })}
                        disabled={disabled}
                        options={SOURCE_TYPES.map((type) => ({ value: type, label: t(`type_${type}`) }))}
                    />
                </label>
                <Input
                    id={pid('author')}
                    size="sm"
                    label={t('field_author')}
                    placeholder={t('field_optional')}
                    value={value.Author}
                    onChange={onInput('Author')}
                    disabled={disabled}
                />
                <RepositoryPicker
                    id={pid('repository')}
                    size="sm"
                    label={t('field_repository')}
                    treeId={treeId}
                    value={value.RepositoryName}
                    onChange={(RepositoryName) => onChange({ RepositoryName })}
                    automatic={automaticRepository}
                    disabled={disabled}
                />
                <Input
                    id={pid('call-number')}
                    size="sm"
                    label={t('field_call_number')}
                    placeholder={t('ph_call_number')}
                    className="font-mono"
                    value={value.CallNumber}
                    onChange={onInput('CallNumber')}
                    disabled={disabled}
                />
                <Input
                    id={pid('url')}
                    size="sm"
                    label={t('field_url')}
                    hint={t('hint_url')}
                    placeholder={t('ph_url')}
                    value={value.Text}
                    onChange={onInput('Text')}
                    disabled={disabled}
                />
                <Input
                    id={pid('publication')}
                    size="sm"
                    label={t('field_publication')}
                    placeholder={t('ph_publication_short')}
                    value={value.PublicationInfo}
                    onChange={onInput('PublicationInfo')}
                    disabled={disabled}
                />
                <label className="block">
                    <span className="block text-sm font-medium text-text-secondary mb-1.5">
                        {t('field_contents_label')}
                    </span>
                    <textarea
                        id={pid('contents')}
                        rows={4}
                        className={SELECT_FIELD_SM}
                        style={{ resize: 'vertical' }}
                        placeholder={t('ph_contents_short')}
                        value={value.Contents}
                        onChange={onTextArea('Contents')}
                        disabled={disabled}
                    />
                </label>
            </div>
        );
    }

    return (
        <>
            <Section title={t('section_identity')} hint={t('hint_identity')}>
                <Input
                    id={pid('title')}
                    label={
                        <>
                            {t('field_title_label')}
                            <span className="ml-[3px]" style={{ color: 'var(--error)' }}>*</span>
                        </>
                    }
                    placeholder={t('ph_title')}
                    value={value.Title}
                    onChange={onInput('Title')}
                    disabled={disabled}
                    autoFocus
                />
                <div className="mt-[14px]">
                    <Input
                        id={pid('abbreviation')}
                        label={t('field_abbreviation')}
                        hint={t('hint_abbreviation')}
                        placeholder={t('ph_abbreviation')}
                        value={value.Abbreviation}
                        onChange={onInput('Abbreviation')}
                        disabled={disabled}
                    />
                </div>
                <div className="gap-[14px] mt-[14px]" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <label className="block">
                        <span className="block text-sm font-medium text-text-secondary mb-1.5">
                            {t('field_type')}
                        </span>
                        <SelectField
                            id={pid('type')}
                            fieldClassName={SELECT_FIELD}
                            value={value.Type}
                            onChange={(type) => onChange({ Type: type })}
                            disabled={disabled}
                            options={SOURCE_TYPES.map((type) => ({ value: type, label: t(`type_${type}`) }))}
                        />
                    </label>
                    <Input
                        id={pid('author')}
                        label={t('field_author')}
                        hint={t('hint_author')}
                        placeholder={t('field_optional')}
                        value={value.Author}
                        onChange={onInput('Author')}
                        disabled={disabled}
                    />
                </div>
            </Section>

            <Section title={t('section_repository')} hint={t('hint_repository_section')}>
                <RepositoryPicker
                    id={pid('repository')}
                    label={t('field_repository')}
                    treeId={treeId}
                    value={value.RepositoryName}
                    onChange={(RepositoryName) => onChange({ RepositoryName })}
                    automatic={automaticRepository}
                    disabled={disabled}
                />
                <div className="gap-[14px] mt-[14px]" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <Input
                        id={pid('call-number')}
                        label={t('field_call_number')}
                        hint={t('hint_call_number')}
                        placeholder={t('ph_call_number')}
                        className="font-mono"
                        value={value.CallNumber}
                        onChange={onInput('CallNumber')}
                        disabled={disabled}
                    />
                    <Input
                        id={pid('url')}
                        label={t('field_url')}
                        hint={t('hint_url')}
                        placeholder={t('ph_url')}
                        value={value.Text}
                        onChange={onInput('Text')}
                        disabled={disabled}
                    />
                </div>
                <div className="mt-[14px]">
                    <Input
                        id={pid('publication')}
                        label={t('field_publication')}
                        hint={t('hint_publication')}
                        placeholder={t('ph_publication')}
                        value={value.PublicationInfo}
                        onChange={onInput('PublicationInfo')}
                        disabled={disabled}
                    />
                </div>
            </Section>

            <Section title={t('section_contents')} hint={t('hint_contents_section')}>
                <label className="block">
                    <span className="block text-sm font-medium text-text-secondary mb-1.5">
                        {t('field_contents_label')}
                    </span>
                    <textarea
                        id={pid('contents')}
                        rows={6}
                        className={SELECT_FIELD}
                        style={{ resize: 'vertical' }}
                        placeholder={t('ph_contents')}
                        value={value.Contents}
                        onChange={onTextArea('Contents')}
                        disabled={disabled}
                    />
                </label>
            </Section>
        </>
    );
}
