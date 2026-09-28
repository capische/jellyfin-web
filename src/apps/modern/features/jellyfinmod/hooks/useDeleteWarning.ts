import { useEffect } from 'react';

import globalize from 'lib/globalize';

/**
 * Adds a warning to stock *Delete media*'s confirmation on this page when the title has more than one file (V1 decision 3,
 * analysis C8), without patching upstream: stock Delete on a movie in its own folder deletes the whole folder with every
 * version. The confirmation is recognised by upstream's own title and this item's name in its text, so a Delete opened
 * for another item from this page (a card's menu) is left alone. Nothing about the dialog's buttons or result changes.
 */
export const useDeleteWarning = (itemName: string | null | undefined, warning: string | null) => {
    useEffect(() => {
        if (!warning || !itemName) return;
        const title = globalize.translate('HeaderDeleteItem');
        const annotate = (dialog: Element) => {
            if (dialog.querySelector('.jfmod-deleteWarning')) return;
            const heading = dialog.querySelector('.formDialogHeaderTitle')?.textContent?.trim();
            const body = dialog.querySelector('.text');
            // Upstream's ConfirmDeleteItemByName quotes the item's own name.
            if (heading !== title || !body || !(body.textContent ?? '').includes(itemName)) return;
            const line = document.createElement('p');
            line.className = 'jfmod-deleteWarning';
            line.setAttribute('role', 'alert');
            line.textContent = warning;
            body.appendChild(line);
        };
        const observer = new MutationObserver(records => {
            for (const record of records) {
                record.addedNodes.forEach(node => {
                    if (!(node instanceof Element)) return;
                    if (node.matches('.dialog')) annotate(node);
                    node.querySelectorAll('.dialog').forEach(annotate);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [itemName, warning]);
};

