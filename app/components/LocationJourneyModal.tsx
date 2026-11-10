'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Button, Card, DialogHeader } from '@/app/components/ui';
import { useJourneyMap } from './useJourneyMap';

export interface JourneyStop {
  lat: number;
  lng: number;
  label: string;   // place name
  title: string;   // event title (already translated)
  date: string | null; // pre-formatted date string for display
}

interface LocationJourneyModalProps {
  stops: JourneyStop[]; // already sorted chronologically by caller
  onClose: () => void;
}

export default function LocationJourneyModal({ stops, onClose }: LocationJourneyModalProps) {
  const t = useTranslations('common');
  const { elRef, failed, focusStop } = useJourneyMap(stops);
  const [legendOpen, setLegendOpen] = useState(false);

  // Esc-to-close, scroll-lock, focus-trap, focus-restore, backdrop click, and the
  // dialog role/aria are all provided by the shared <Modal> wrapper below.

  return (
    <Modal open onClose={onClose} size="xl" labelledBy="journey-title">
      <Card
        pad={false}
        className="w-full flex flex-col overflow-hidden shadow-xl"
        style={{ height: '80vh', maxHeight: '80vh' }}
      >
        <DialogHeader
          title={t('journey_title')}
          titleId="journey-title"
          onClose={onClose}
          className="px-4 py-3 border-b border-border"
        />
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div ref={elRef} style={{ position: 'absolute', inset: 0 }} />
          {failed && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="text-text-muted text-meta">{t('map_unavailable')}</span>
            </div>
          )}
          {/* Collapsible legend — top-right to avoid the top-left zoom controls. */}
          <div className="top-2 right-2 z-[1000]" style={{ position: 'absolute', maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLegendOpen(o => !o)}
              className="text-meta"
              style={{ padding: '6px 10px' }}
              aria-expanded={legendOpen}
            >
              {legendOpen ? '▾' : '▸'} {stops.length}
            </Button>
            {legendOpen && (
              <Card pad={false} className="shadow-sm mt-1.5 p-2" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                {stops.map((s, i) => (
                  <button
                    key={`${s.label}-${i}`}
                    type="button"
                    onClick={() => focusStop(i)}
                    className="hover:bg-hover-surface py-1.5 px-2 rounded-[6px] text-sm"
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <span className="font-semibold">{i + 1}.</span> {s.title}
                    {s.date && <span className="muted"> · {s.date}</span>}
                    <div className="text-text-secondary text-meta">{s.label}</div>
                  </button>
                ))}
              </Card>
            )}
          </div>
        </div>
      </Card>
    </Modal>
  );
}
