import layoutManager from 'components/layoutManager';

/** Presentation only; item IDs, callbacks, history and focus stay in upstream's action sheet. */
export const hasChromeSheet = () => document.documentElement.classList.contains('jfmod-chrome');

export const decorateChromeSheet = (dialog: HTMLElement, items: { divider?: boolean; selected?: boolean; icon?: string; id?: string }[]) => {
    if (!hasChromeSheet()) return;
    const rows = dialog.querySelectorAll<HTMLElement>('.actionSheetMenuItem');
    items.filter(item => !item.divider).forEach((item, index) => {
        const row = rows[index];
        if (!row) return;
        row.classList.toggle('jfmod-currentChoice', !!item.selected);
        row.classList.toggle('jfmod-menuDestroy', item.id === 'delete');
        // A selected entry's check moves into its padding. Keep any other leading icon.
        if (!item.icon) row.querySelector('.actionsheetMenuItemIcon')?.classList.add('jfmod-menuCheck');
    });
    rows.forEach(row => {
        if (row.classList.contains('jfmod-menuDestroy')) row.parentElement?.appendChild(row);
    });
    if (!layoutManager.mobile) {
        // Float on the page/video without dimming it; the transparent backdrop still handles outside clicks.
        dialog.addEventListener('open', () => {
            (dialog as HTMLElement & { backdrop?: HTMLElement }).backdrop?.classList.add('dialogBackdrop-clear');
        }, { once: true });
    }
};

/** Put paper a φ^-2 gap from its anchor, flipping above it when the room is below. */
export const chromeSheetPosition = (anchor: Element, dialog: HTMLElement) => {
    const box = anchor.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(dialog).fontSize);
    const gap = 0.382 * em;
    const width = dialog.offsetWidth;
    const height = dialog.offsetHeight;
    const below = box.bottom + gap;
    const above = box.top - gap - height;
    const top = below + height <= window.innerHeight - em ? below : above;
    const left = Math.max(em, Math.min(box.left, window.innerWidth - em - width));
    dialog.style.transformOrigin = `${top >= box.bottom ? 'top' : 'bottom'} left`;
    return { top: Math.max(em, top), left };
};
