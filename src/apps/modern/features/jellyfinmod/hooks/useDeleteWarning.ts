import { useEffect } from 'react';

import globalize from 'lib/globalize';

/** Where one stock Delete on this page has got to; anything else returns it to `idle`. */
type Stage = 'idle' | 'menuPending' | 'menuOpen' | 'deleteChosen' | 'confirmOpen';

const isDeleteConfirmation = (dialog: Element) => {
    const heading = dialog.querySelector('.formDialogHeaderTitle')?.textContent?.trim();
    return !!dialog.querySelector('.formDialogFooter .button-delete') || heading === globalize.translate('HeaderDeleteItem');
};

/**
 * Adds a warning to stock *Delete media*'s confirmation on this page when the title has more than one file (V1 decision 3,
 * analysis C8), without patching upstream: stock Delete on a movie in its own folder deletes the whole folder with every
 * version. Nothing about the dialog's buttons or result changes.
 *
 * The warning belongs to exactly one sequence, which is how upstream deletes this page's item: this page's More button
 * opens an action sheet, its `delete` item is chosen, and the next dialog to open is upstream's confirmation. Any other
 * click on the page, a menu closed without Delete, or the confirmation closing ends the sequence, so a later dialog (the
 * mod's own Remove this version, another item's Delete) is never annotated.
 */
export const useDeleteWarning = (view: HTMLElement, warning: string | null) => {
    useEffect(() => {
        if (!warning) return;
        let stage: Stage = 'idle';
        let menu: Element | null = null;
        let confirmation: Element | null = null;
        // The dialogs already open when Delete was chosen; the confirmation is the first one that is not among them.
        let before = new Set<Element>();

        const openDialogs = () => Array.from(document.querySelectorAll('.dialog'));
        const reset = () => {
            stage = 'idle';
            menu = null;
            confirmation = null;
            before = new Set();
            observer.disconnect();
        };
        const annotate = (dialog: Element) => {
            const body = dialog.querySelector('.text');
            if (!body || dialog.querySelector('.jfmod-deleteWarning') || !isDeleteConfirmation(dialog)) return;
            const line = document.createElement('p');
            line.className = 'jfmod-deleteWarning';
            line.setAttribute('role', 'alert');
            line.textContent = warning;
            body.appendChild(line);
        };
        // Upstream inserts a dialog before it fills in its title and text, so every change looks again.
        const observer = new MutationObserver(() => {
            if (stage === 'menuPending') {
                menu = openDialogs().find(dialog => dialog.classList.contains('actionSheet')) ?? null;
                if (menu) stage = 'menuOpen';
            } else if (stage === 'menuOpen') {
                if (!menu?.isConnected) reset();
            } else if (stage === 'deleteChosen') {
                confirmation = openDialogs().find(dialog => !before.has(dialog) && !dialog.classList.contains('actionSheet')) ?? null;
                if (confirmation) {
                    stage = 'confirmOpen';
                    annotate(confirmation);
                }
            } else if (stage === 'confirmOpen') {
                if (confirmation?.isConnected) annotate(confirmation);
                else reset();
            }
        });
        const watch = () => observer.observe(document.body, { childList: true, subtree: true });

        const onClick = (event: Event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target && view.contains(target) && target.closest('.btnMoreCommands')) {
                // Only the page's own More menu acts on this page's item (the selected version, else the item).
                reset();
                stage = 'menuPending';
                watch();
                return;
            }
            if (stage === 'menuOpen' && menu && target && menu.contains(target)) {
                const item = target.closest('.actionSheetMenuItem');
                if (!item) return;
                if (item.getAttribute('data-id') === 'delete') {
                    stage = 'deleteChosen';
                    before = new Set(openDialogs().filter(dialog => dialog !== menu));
                } else {
                    reset();
                }
                return;
            }
            // A click outside any dialog while the sequence waits for its next dialog means something else happened.
            if ((stage === 'menuPending' || stage === 'deleteChosen') && !target?.closest('.dialog')) reset();
        };
        document.addEventListener('click', onClick, true);
        // Marks the page while the warning is armed, for acceptance checks; it names nothing.
        document.body.dataset.jfmodDeleteWarning = '1';
        return () => {
            document.removeEventListener('click', onClick, true);
            observer.disconnect();
            delete document.body.dataset.jfmodDeleteWarning;
        };
    }, [view, warning]);
};
