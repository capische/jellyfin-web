import React, { type FC, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';

import { removeEntry } from '../api/modApi';
import { invalidateCatalog } from '../integration/invalidateCatalog';

interface Addition { basePath: string; userId: string; entryId: string; returnHash: string }
let addition: Addition | undefined;

/** Only a newly created entry may be undone; a duplicate/racing Add never arms this action. */
export const rememberLibraryAddition = (value: Addition) => {
    addition = value;
};

const LibraryUndo: FC<{ entryId: string; view: HTMLElement }> = ({ entryId, view }) => {
    const { api, user } = useApi();
    const [busy, setBusy] = useState(false);
    const current = addition;
    const eligible = !!user?.Policy?.IsAdministrator && current?.entryId === entryId && current.basePath === api?.basePath && current.userId === user?.Id;
    useEffect(() => () => {
        if (eligible && addition === current) addition = undefined;
    }, [current, eligible]);
    const slot = view.querySelector('[data-ds-slot="notice"]');
    if (!eligible || !slot || !api) return null;
    const undo = async () => {
        if (busy) return;
        setBusy(true);
        const openedAt = window.location.hash;
        try {
            await removeEntry(api, entryId);
            addition = undefined;
            invalidateCatalog(api);
            if (window.location.hash === openedAt) window.location.replace(current.returnHash);
        } catch {
            toast('Could not undo. The title is still in the catalog.');
            setBusy(false);
        }
    };
    return createPortal(<div className='undo2' role='status'>
        Added to Library
        <button type='button' className='btn focusable' aria-disabled={busy} onClick={undo}>Undo</button>
    </div>, slot);
};

export default LibraryUndo;
