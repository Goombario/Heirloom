'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, FormDialog, SegmentedControl } from '@/app/components/ui';
import type { CaseWithRelations, CaseWorkspace } from '@/lib/db/schema';
import { CaseReport } from './CaseReport';
import { caseExportJson, caseExportName, saveBlob } from './case-export';
import type { LeadSummary } from './useCaseWorkspace';

type Format = 'pdf' | 'json';

/**
 * Export the case (#58): a PDF to read, through the print dialog's Save as PDF,
 * or JSON with every record, downloaded.
 */
export function ExportDialog({ caseData, workspace, onPrint, onClose }: {
    caseData: CaseWithRelations;
    workspace: CaseWorkspace;
    /** Lay the case out to print. */
    onPrint: () => void;
    onClose: () => void;
}) {
    const t = useTranslations('caseResearch');
    const tc = useTranslations('common');
    const [format, setFormat] = useState<Format>('pdf');

    const go = () => {
        if (format === 'json') {
            const json = JSON.stringify(caseExportJson(caseData, workspace), null, 2);
            saveBlob(new Blob([json], { type: 'application/json' }), caseExportName(caseData, 'json'));
        } else {
            onPrint();
        }
        onClose();
    };

    return (
        <FormDialog
            open
            onClose={onClose}
            title={t('export_case')}
            subtitle={caseData.Title}
            footer={(requestClose) => (
                <>
                    <Button variant="outline" onClick={requestClose}>{tc('cancel')}</Button>
                    <Button onClick={go}>{format === 'pdf' ? t('export_pdf_go') : t('export_json_go')}</Button>
                </>
            )}
        >
            <div className="grid gap-3">
                <SegmentedControl
                    aria-label={t('export_format')}
                    value={format}
                    onChange={(v) => setFormat(v as Format)}
                    options={[{ v: 'pdf', l: t('export_pdf') }, { v: 'json', l: t('export_json') }]}
                />
                <p className="m-0 text-sm text-text-secondary">{format === 'pdf' ? t('export_pdf_hint') : t('export_json_hint')}</p>
            </div>
        </FormDialog>
    );
}

/**
 * The case laid out to print. The report renders hidden, and a copy of it goes
 * straight into the page body for the print dialog: printing lays the page out
 * at paper width, which can swap the desktop page for the phone one (and unmount
 * this) while the dialog is open, so the copy stays until the dialog closes. The
 * dialog offers the tab's title, the case's question, as the PDF's name.
 */
export function CasePrint({ caseData, workspace, summaries, onDone }: {
    caseData: CaseWithRelations;
    workspace: CaseWorkspace;
    summaries: LeadSummary[];
    /** Called once the print dialog closes; keep it stable, or printing starts again. */
    onDone: () => void;
}) {
    const source = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!source.current) return;
        const copy = source.current.cloneNode(true) as HTMLDivElement;
        copy.hidden = false;
        copy.className = 'case-print';
        document.body.appendChild(copy);
        let started = false;
        const done = () => {
            copy.remove();
            window.removeEventListener('afterprint', done);
            onDone();
        };
        window.addEventListener('afterprint', done);
        // A frame first, so the copy is laid out before the dialog opens.
        const frame = window.requestAnimationFrame(() => { started = true; window.print(); });
        return () => {
            window.cancelAnimationFrame(frame);
            // Once the dialog is open, the copy stays until it closes.
            if (!started) {
                copy.remove();
                window.removeEventListener('afterprint', done);
            }
        };
    }, [onDone]);

    return createPortal(
        <div ref={source} hidden>
            <CaseReport caseData={caseData} workspace={workspace} summaries={summaries} />
        </div>,
        document.body,
    );
}
