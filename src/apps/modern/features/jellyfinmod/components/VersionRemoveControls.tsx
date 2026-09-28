import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, type MouseEvent, useCallback, useMemo } from 'react';

import confirm from 'components/confirm/confirm';

import { removeVersion } from '../api/modApi';
import { REMOVE_VERSION_REFUSED, removeVersionText, versionName, VERSIONS_REMOVE_CAPABILITY } from '../constants/versions';
import type { VersionDto } from '../types/versions';

interface VersionRemoveControlsProps {
    api: Api;
    entryId: string;
    mediaType: 'movie' | 'series';
    busy: boolean;
    /**
     * Runs one administrator change, refreshes the page and announces `done`; a failure carrying `jfmodMessage` is
     * announced in those words.
     */
    change: (action: () => Promise<unknown>, done: string) => Promise<void>;
    versions: VersionDto[];
    capabilities: string[];
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
const VersionRemoveControls: FC<VersionRemoveControlsProps> = ({ api, entryId, mediaType, busy, change, versions, capabilities }) => {
    const removable = useMemo(() => (capabilities.includes(VERSIONS_REMOVE_CAPABILITY) ?
        versions.filter(version => version.removable && version.tracked !== false) : []), [capabilities, versions]);
    const remove = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const version = removable.find(candidate => candidate.bindingId === event.currentTarget.dataset.jfmodBindingId);
        if (!version || busy) return;
        confirm({
            title: 'Remove this version',
            text: removeVersionText(version, mediaType),
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
        () => undefined).catch(() => undefined);
    }, [api, busy, change, entryId, mediaType, removable]);

    return <>
        {removable.map(version => <button key={'remove:' + version.bindingId} className='emby-button raised' type='button'
            aria-disabled={busy} data-jfmod-binding-id={version.bindingId} data-jfmod-remove-version='' onClick={remove}>
            Remove {versionName(version)}
        </button>)}
    </>;
};

export default VersionRemoveControls;
