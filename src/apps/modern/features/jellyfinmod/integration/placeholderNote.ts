/**
 * The line the plugin puts in front of a placeholder item's overview for native apps (`PlaceholderItems.Note`, P1.FU31): they show a
 * placeholder as an ordinary item and are told only this. The web app shows its own Not Downloaded marks, so it takes the line out
 * of upstream's overviews on the details page (the item's own and its episode rows'), leaving the title's own overview.
 */
export const PLACEHOLDER_NOTE = 'Not downloaded yet. Request it from the JellyfinMod web app.';

const OVERVIEWS = '.overview, .listItem-overview, .listItem-bottomoverview';

/** Removes the note's paragraph from every overview upstream rendered (as Markdown) inside `root`. */
export function removePlaceholderNote(root: ParentNode): void {
    for (const overview of root.querySelectorAll<HTMLElement>(OVERVIEWS)) {
        const note = [...overview.querySelectorAll('p')].find(paragraph => paragraph.textContent?.trim() === PLACEHOLDER_NOTE);
        if (!note) continue;
        note.remove();
        if (!overview.textContent?.trim()) {
            if (overview.classList.contains('overview')) overview.classList.add('hide');
            else overview.remove();
            continue;
        }
        // Upstream sized its Show More link to the text with the note; size it again.
        const expand = overview.parentElement?.querySelector('.overview-expand');
        if (expand && overview.classList.contains('detail-clamp-text')) {
            expand.classList.toggle('hide', Math.abs(overview.scrollHeight - overview.offsetHeight) <= 2);
        }
    }
}

/** Keeps the note out of `root` while it lives (upstream draws its overviews after its own reads); returns the stop function. */
export function observePlaceholderNote(root: HTMLElement): () => void {
    removePlaceholderNote(root);
    const observer = new MutationObserver(() => removePlaceholderNote(root));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
}
