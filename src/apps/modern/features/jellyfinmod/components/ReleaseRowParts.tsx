import { qualityLabel } from '../constants/quality';
import type { ParsedRelease } from '../types/acquisition';

export const formatSize = (bytes: number | null) => {
    if (bytes === null) return '—';
    // The mock writes every size in GB with one decimal (0.4 GB, 9.8 GB); only the very small stay in MB.
    if (bytes >= 1e8) return (bytes / 1e9).toFixed(1) + ' GB';
    return Math.max(1, Math.round(bytes / 1e6)) + ' MB';
};

/** `4K WEB-DL`, `4K BDRip`: the resolution and source only, named as everywhere (constants/quality); everything else becomes a mark or a line. */
export const qualityText = (parsed: ParsedRelease) => qualityLabel(parsed.resolution, parsed.source, parsed.rip) || 'Unknown quality';

export type MarkSource = Pick<ParsedRelease, 'codec' | 'hdr' | 'audio' | 'audioChannels'>;
