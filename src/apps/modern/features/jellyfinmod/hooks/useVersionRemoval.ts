import type { Api } from '@jellyfin/sdk/lib/api';
import escapeHtml from 'escape-html';
import { useCallback, useRef } from 'react';

import confirm from 'components/confirm/confirm';

import { removeVersion } from '../api/modApi';
import { REMOVE_VERSION_REFUSED, removeVersionText } from '../constants/versions';
import type { VersionDto } from '../types/versions';

interface VersionRemovalOptions {
    api: Api;
    entryId: string | undefined;
    mediaType: 'movie' | 'series' | undefined;
    busy: boolean;
    /**
     * Runs one administrator change, refreshes the page and announces `done`; a failure carrying `jfmodMessage` is announced
     * in those words. Resolves true when the change was made.
     */
    change: (action: () => Promise<unknown>, done: string) => Promise<boolean>;
    /** After a removal: the native page still shows the removed copy, so the page takes the viewer on from here. */
    onRemoved: (version: VersionDto) => void;
}

/** The refusal reason a 409 from Remove carries, if any. */
const refusal = (error: unknown): string | null => {
    const data = (error as { response?: { status?: number; data?: { reason?: string } } })?.response;
    return data?.status === 409 && data.data?.reason ? data.data.reason : null;
};

/**
 * Remove this version (V1 decision 3, answered 2026-09-28), now the cross on a file's row (design step 2). Upstream's own
 * confirmation says exactly what goes and what stays before anything happens; on a TV it is a D-pad dialog and Back cancels.
 */
export const useVersionRemoval = ({ api, entryId, mediaType, busy, change, onRemoved }: VersionRemovalOptions) => {
    // One removal at a time from the first click: a second click (or Enter) while the confirmation is opening or the request
    // is running does nothing, whatever React has rendered yet.
    const pending = useRef(false);
    return useCallback((version: VersionDto) => {
        if (!entryId || !mediaType || busy || pending.current) return;
        pending.current = true;
        confirm({
            title: 'Remove This Version',
            // The stock dialog renders its text as sanitized HTML and treats any .btnOption inside it as an answer, so file
            // names and labels from metadata are escaped: never markup, never a working button (whole-review P1 11).
            text: escapeHtml(removeVersionText(version, mediaType)),
            confirmText: version.isLast ? 'Remove the Last Copy' : 'Remove This Version',
            primary: 'delete'
        }).then(() => change(async () => {
            try {
                await removeVersion(api, entryId, version.bindingId);
            } catch (error) {
                const reason = refusal(error);
                if (!reason) throw error;
                const words = REMOVE_VERSION_REFUSED.get(reason) ?? `This version was not removed (${reason}).`;
                throw Object.assign(new Error(words), { jfmodMessage: words });
            }
        }, version.isLast ? 'The last copy was removed. The title is no longer monitored.' : 'The version was removed.'),
        () => false).then(removed => {
            if (removed) onRemoved(version);
        }).catch(() => undefined).finally(() => {
            pending.current = false;
        });
    }, [api, busy, change, entryId, mediaType, onRemoved]);
};
