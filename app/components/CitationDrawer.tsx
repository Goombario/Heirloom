'use client';

import AttachSourceSidebar from './AttachSourceSidebar';
import type { CitationFactDescriptor } from './citations/types';
import type { ResearchSubject } from '@/lib/research/subject';

interface CitationDrawerProps {
  /** The record's name, shown as the editor's subject. */
  title: string;
  fact: CitationFactDescriptor;
  canDetach: boolean;
  onClose: () => void;
  onChanged?: () => void;
  initialCitationId?: number | null;
  initialView?: 'attached' | 'add' | 'editor' | 'search';
  /** The fact's person, for the Search records tab (#1028). */
  research?: ResearchSubject | null;
  /** False for a viewer: Search records only, without citing. */
  canCite?: boolean;
}

/**
 * The citation workspace for one fact: attach, add and edit its citations.
 * It always opens on a fact (a chip's Edit citation, or an unsourced pin); the
 * owner-wide "Manage all citations" list is retired (#780), since each fact's
 * chip popover already lists every citation on it (#756).
 */
export default function CitationDrawer({
  title, fact, canDetach, onClose, onChanged, initialCitationId = null, initialView, research, canCite,
}: CitationDrawerProps) {
  return (
    <AttachSourceSidebar
      factTable={fact.factTable}
      factId={fact.factId}
      factLabel={fact.value ? `${fact.label} — ${fact.value}` : fact.label}
      personName={title}
      existingCitations={fact.citations}
      initialCitationId={initialCitationId}
      initialView={initialView}
      canDetach={canDetach}
      research={research}
      canCite={canCite}
      onClose={onClose}
      onAttached={onChanged}
    />
  );
}
