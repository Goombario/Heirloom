'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { fieldClass } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import type { CaseLead } from '@/lib/db/schema';
import type { CaseFindingInput } from '@/lib/data/types';
import { CaseFormFrame } from './CaseFormFrame';

/** A file's name without its extension, as the title it starts with. */
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim();

/**
 * + Add media on a lead (#58): a scan or photo added straight to the lead. It is
 * saved as a record with no claims yet, so it is filed under the lead, logged in
 * the journal and listed in All evidence; its claims can be added on its card.
 */
export function AddMediaDialog({ lead, treeId, sheet = false, onSave, onClose }: {
    lead: CaseLead;
    treeId: number | null;
    /** On a phone, a full sheet (#135). */
    sheet?: boolean;
    /** Resolves false when the save failed, keeping the dialog. */
    onSave: (input: CaseFindingInput) => Promise<boolean>;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ready = file != null && title.trim() !== '' && !busy;

    const save = async () => {
        if (!ready || !file) return;
        setBusy(true);
        setError(null);
        try {
            const client = await getDataClient();
            const media = await client.media.upload({ file, title: title.trim() }, treeId);
            const ok = await onSave({
                kind: 'record',
                leadIds: [lead.Id],
                source: { title: title.trim(), repository: null },
                page: null, url: null, transcription: null, mediaId: media.Id,
                sourceNature: null, information: null, requestId: null,
                claims: [],
            });
            setBusy(false);
            if (ok) onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
        }
    };

    return (
        <CaseFormFrame sheet={sheet} title={t('add_media')} subtitle={lead.Question} dirty={file != null} busy={busy} ready={ready}
            saveLabel={t('add_media_save')} onSave={save} onClose={onClose}>
            <div className="grid gap-5">
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('add_media_file')}
                    <input type="file" accept="image/*,application/pdf"
                        onChange={(e) => {
                            const next = e.target.files?.[0] ?? null;
                            setFile(next);
                            if (next && title.trim() === '') setTitle(baseName(next.name));
                        }}
                        className="text-sm text-text file:mr-3 file:h-8 file:cursor-pointer file:rounded-btn file:border file:border-solid file:border-border file:bg-card file:px-3 file:text-sm file:text-text" />
                </label>
                <label className="grid gap-1.5 text-sm text-text-secondary">
                    {t('add_media_title')}
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} className={fieldClass()}
                        placeholder={t('add_media_title_hint')} />
                </label>
                <p className="m-0 text-meta text-text-muted">{t('add_media_note')}</p>
                {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
            </div>
        </CaseFormFrame>
    );
}
