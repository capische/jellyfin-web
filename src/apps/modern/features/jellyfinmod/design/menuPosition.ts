/** Put paper a φ^-2 gap from its anchor, flipping above it when the room is below. */
export const menuPosition = (anchor: Element, dialog: HTMLElement, gapEms = 0.382) => {
    const box = anchor.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(dialog).fontSize);
    const gap = gapEms * em;
    const width = dialog.offsetWidth;
    const height = dialog.offsetHeight;
    const below = box.bottom + gap;
    const above = box.top - gap - height;
    const top = below + height <= window.innerHeight - em ? below : above;
    const left = Math.max(em, Math.min(box.left, window.innerWidth - Math.max(em, window.innerWidth * 0.033) - width));
    dialog.style.transformOrigin = `${top >= box.bottom ? 'top' : 'bottom'} left`;
    return { top: Math.max(em, top), left };
};
