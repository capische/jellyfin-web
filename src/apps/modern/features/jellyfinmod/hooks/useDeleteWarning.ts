import { useEffect } from 'react';

import globalize from 'lib/globalize';

/**
 * Adds a warning to stock *Delete media*'s confirmation on this page when the title has more than one file (V1 decision 3,
 * analysis C8), without patching upstream: stock Delete on a movie in its own folder deletes the whole folder with every
 * version. The confirmation is recognised by upstream's own title and this item's name in its text, so a Delete opened
 * for another item from this page (a card's menu) is left alone. Nothing about the dialog's buttons or result changes.
 */
export const useDeleteWarning = (view: HTMLElement, itemNames: (string | null | undefined)[], warning: string | null) => {
    const names = itemNames.filter((name): name is string => !!name).join('\u0000');
    useEffect(() => {
        const candidates = names ? names.split('\u0000') : [];
        if (!warning) return;
        // The page's own More menu opened the confirmation when its button was used just before: that menu acts on this
        // page's item. A name in the text serves as well, for a confirmation opened some other way.
        let moreOpenedAt = 0;
        const noteMore = (event: Event) => {
            if (event.target instanceof Element && event.target.closest('.btnMoreCommands')) moreOpenedAt = Date.now();
        };
        view.addEventListener('click', noteMore, true);
        const annotate = (dialog: Element) => {
            if (dialog.querySelector('.jfmod-deleteWarning')) return;
            // Upstream's confirmation for a deletion: its primary button is a `button-delete`, or its title is upstream's
            // own Delete Item heading; its text quotes the item's name (ConfirmDeleteItemByName).
            const heading = dialog.querySelector('.formDialogHeaderTitle')?.textContent?.trim();
            const deleting = !!dialog.querySelector('.formDialogFooter .button-delete')
                || heading === globalize.translate('HeaderDeleteItem');
            const body = dialog.querySelector('.text');
            const ours = Date.now() - moreOpenedAt < 60000 || candidates.some(name => (body?.textContent ?? '').includes(name));
            if (!deleting || !body || !ours) return;
            const line = document.createElement('p');
            line.className = 'jfmod-deleteWarning';
            line.setAttribute('role', 'alert');
            line.textContent = warning;
            body.appendChild(line);
        };
        // Upstream inserts the dialog before it fills in its title and text, and the order differs between layouts, so
        // every change looks at each open dialog again until one reads as this item's Delete confirmation.
        const observer = new MutationObserver(() => {
            document.querySelectorAll('.dialog').forEach(annotate);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Marks the page while the warning is armed, for acceptance checks; it names nothing.
        document.body.dataset.jfmodDeleteWarning = String(candidates.length);
        return () => {
            view.removeEventListener('click', noteMore, true);
            observer.disconnect();
            delete document.body.dataset.jfmodDeleteWarning;
        };
    }, [view, names, warning]);
};

