import type { Api } from '@jellyfin/sdk/lib/api';
import escapeHtml from 'escape-html';
import React, { type FC, type MouseEvent, useCallback, useMemo, useRef } from 'react';

import confirm from 'components/confirm/confirm';

import { removeVersion } from '../api/modApi';
import { REMOVE_VERSION_REFUSED, removeVersionText, versionName, VERSIONS_REMOVE_CAPABILITY } from '../constants/versions';
import type { VersionDto } from '../types/versions';
import { raisedButtonClass } from '../utils/flatButton';

interface VersionRemoveControlsProps {
    api: Api;
    entryId: string;
    mediaType: 'movie' | 'series';
    busy: boolean;
    /**
     * Runs one administrator change, refreshes the page and announces `done`; a failure carrying `jfmodMessage` is
     * announced in those words. Resolves true when the change was made.
     */
    change: (action: () => Promise<unknown>, done: string) => Promise<boolean>;
    versions: VersionDto[];
    capabilities: string[];
    /** After a removal: the native page still shows the removed copy, so the page takes the viewer on from here. */
    onRemoved: (version: VersionDto) => void;
}

/** The refusal reason a 409 from Remove carries, if any. */
const refusal = (error: unknown): string | null => {
    const data = (error as { response?: { status?: number; data?: { reason?: string } } })?.response;
    return data?.status === 409 && data.data?.reason ? data.data.reason : null;
};

/**
 * Remove this version, one button per removable file (V1 decision 3, answered 2026-09-28). Administrators only. Upstream's
 * own confirmation says exactly what goes and what stays before anything happens; on a TV it is a D-pad dialog and Back
 * cancels. Plain buttons in the page's focus flow, like Keep.
 */
const VersionRemoveControls: FC<VersionRemoveControlsProps> = ({ api, entryId, mediaType, busy, change, versions, capabilities,
    onRemoved }) => {
    const removable = useMemo(() => (capabilities.includes(VERSIONS_REMOVE_CAPABILITY) ?
        versions.filter(version => version.removable && version.tracked !== false) : []), [capabilities, versions]);
    // One removal at a time from the first click: a second click (or Enter) while the confirmation is opening or the request
    // is running does nothing, whatever React has rendered yet.
    const pending = useRef(false);
    const remove = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const version = removable.find(candidate => candidate.bindingId === event.currentTarget.dataset.jfmodBindingId);
        if (!version || busy || pending.current) return;
        pending.current = true;
        confirm({
            title: 'Remove this version',
            // The stock dialog renders its text as sanitized HTML and treats any .btnOption inside it as an answer, so
            // file names and labels from metadata are escaped: never markup, never a working button (whole-review P1 11).
            text: escapeHtml(removeVersionText(version, mediaType)),
            confirmText: version.isLast ? 'Remove the last copy' : 'Remove this version',
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
    }, [api, busy, change, entryId, mediaType, onRemoved, removable]);

    return <>
        {removable.map(version => <button key={'remove:' + version.bindingId} className={raisedButtonClass()} type='button'
            aria-disabled={busy} data-jfmod-binding-id={version.bindingId} data-jfmod-remove-version='' onClick={remove}>
            Remove {versionName(version)}
        </button>)}
    </>;
};

export default VersionRemoveControls;
