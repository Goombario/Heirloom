import type {
  GedcomClient, GedcomDryRunResponse, GedcomImportResponse,
  SpreadsheetDryRunResponse, SpreadsheetImportResponse, MediaImportItem, MediaImportMaterializationOutcome,
  ExportArtifact, GedcomExportOptions, MediaExportPreflight,
} from '../types';
import { throwForStatus } from './shared';

/** GEDCOM/spreadsheet import + reset backed by the hosted REST API. (Server-only.) */
export class HttpGedcomClient implements GedcomClient {
  async preflightExport(treeId?: number | null): Promise<MediaExportPreflight> {
    const params = new URLSearchParams({ preflight: 'true', includeMedia: 'true' });
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/export/gedcom?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return await res.json() as MediaExportPreflight;
  }

  async exportGedcom(options: GedcomExportOptions = {}, treeId?: number | null): Promise<ExportArtifact> {
    const params = new URLSearchParams();
    if (options.includeMedia) params.set('includeMedia', 'true');
    if (options.mediaPolicy != null) params.set('mediaPolicy', options.mediaPolicy);
    if (treeId != null) params.set('treeId', String(treeId));
    const query = params.toString();
    const res = await fetch(`/api/export/gedcom${query ? `?${query}` : ''}`, { method: 'GET' });
    if (!res.ok) await throwForStatus(res);
    const blob = await res.blob();
    const contentType = res.headers.get('content-type') ?? '';
    return {
      blob,
      filename: contentType.includes('application/zip') ? 'family_tree_export.zip' : 'family_tree.ged',
    };
  }

  async previewGedcom({ file, mode, mediaJson, sourcesJson }: { file: File; mode: 'overwrite' | 'merge'; mediaJson?: string | null; sourcesJson?: string | null }, treeId?: number | null): Promise<GedcomDryRunResponse> {
    const fd = new FormData();
    fd.append('file', file);
    if (mediaJson) fd.append('mediaJson', mediaJson);
    if (sourcesJson) fd.append('sourcesJson', sourcesJson);
    const res = await fetch(`/api/import/gedcom?mode=${mode}&dryRun=true${treeId != null ? `&treeId=${treeId}` : ''}`, { method: 'POST', body: fd });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as GedcomDryRunResponse;
  }

  async importGedcom({ file, mode, casesJson, mediaJson, sourcesJson, placesJson, archiveManifest }: { file: File; mode: 'overwrite' | 'merge'; casesJson?: string | null; mediaJson?: string | null; sourcesJson?: string | null; placesJson?: string | null; archiveManifest?: string[] }, treeId?: number | null): Promise<GedcomImportResponse> {
    const fd = new FormData();
    fd.append('file', file);
    if (casesJson) fd.append('casesJson', casesJson);
    if (mediaJson) fd.append('mediaJson', mediaJson);
    if (sourcesJson) fd.append('sourcesJson', sourcesJson);
    if (placesJson) fd.append('placesJson', placesJson);
    if (archiveManifest) fd.append('archiveManifest', JSON.stringify(archiveManifest));
    const res = await fetch(`/api/import/gedcom?mode=${mode}${treeId != null ? `&treeId=${treeId}` : ''}`, { method: 'POST', body: fd });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as GedcomImportResponse;
  }

  async listUnresolvedImportMedia(treeId?: number | null): Promise<MediaImportItem[]> {
    const res = await fetch(`/api/import/gedcom/media${treeId != null ? `?treeId=${treeId}` : ''}`);
    if (!res.ok) await throwForStatus(res);
    const body = await res.json() as { items: MediaImportItem[] };
    return body.items;
  }

  async markImportMediaMissing(itemIds: number[], treeId?: number | null): Promise<MediaImportItem[]> {
    const res = await fetch(`/api/import/gedcom/media${treeId != null ? `?treeId=${treeId}` : ''}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) await throwForStatus(res);
    const body = await res.json() as { items: MediaImportItem[] };
    return body.items;
  }

  async materializeImportMedia(itemId: number, archivePath: string, file: File, treeId?: number | null): Promise<MediaImportMaterializationOutcome> {
    const fd = new FormData();
    fd.append('archivePath', archivePath);
    fd.append('file', file);
    const res = await fetch(`/api/import/gedcom/media/${itemId}${treeId != null ? `?treeId=${treeId}` : ''}`, { method: 'POST', body: fd });
    if (!res.ok) await throwForStatus(res);
    return await res.json() as MediaImportMaterializationOutcome;
  }

  async removeUnresolvedImportMedia(itemId: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/import/gedcom/media/${itemId}${treeId != null ? `?treeId=${treeId}` : ''}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }

  async removeUnresolvedImportMediaBatch(itemIds: number[], treeId?: number | null): Promise<number[]> {
    const res = await fetch(`/api/import/gedcom/media${treeId != null ? `?treeId=${treeId}` : ''}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) await throwForStatus(res);
    const body = await res.json() as { removedIds: number[] };
    return body.removedIds;
  }

  async previewSpreadsheet(file: File, dateFormat: 'MDY' | 'DMY', treeId?: number | null): Promise<SpreadsheetDryRunResponse> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/import/spreadsheet?dateFormat=${dateFormat}${treeId != null ? `&treeId=${treeId}` : ''}`, { method: 'POST', body: fd });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as SpreadsheetDryRunResponse;
  }

  async importSpreadsheet(file: File, dateFormat: 'MDY' | 'DMY', treeId?: number | null): Promise<SpreadsheetImportResponse> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/import/spreadsheet?confirm=true&dateFormat=${dateFormat}${treeId != null ? `&treeId=${treeId}` : ''}`, { method: 'POST', body: fd });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as SpreadsheetImportResponse;
  }

  async reset(): Promise<{ success: true; message: string }> {
    const res = await fetch('/api/reset', { method: 'DELETE', headers: { 'X-Confirm-Reset': 'CONFIRM_DELETE_ALL_DATA' } });
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { success: true; message: string };
  }
}
