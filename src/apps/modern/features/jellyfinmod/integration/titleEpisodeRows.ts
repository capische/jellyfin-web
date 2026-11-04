/** Mirror only the native, read-only synopsis below the phone row; React-owned missing/browse rows draw their own. */
export const titleEpisodeRows = (view: HTMLElement) => {
    if (!document.documentElement.classList.contains('layout-mobile')) return;
    const list = view.querySelector('#listChildrenCollapsible');
    if (!list) return;
    const refresh = () => {
        list.querySelectorAll<HTMLElement>('.listItem:not(.jfmod-missingSlot):not(.jfmod-browseEpisode)').forEach(row => {
            const source = row.querySelector('.listItemBody .listItem-overview');
            if (!source) return;
            const content = source.parentElement?.parentElement;
            if (!content) return;
            let summary = content.querySelector('.jfmod-episodeSummary');
            if (!summary) {
                summary = document.createElement('div');
                summary.className = 'secondary jfmod-episodeSummary';
                content.appendChild(summary);
            }
            if (summary.textContent !== source.textContent) summary.textContent = source.textContent;
        });
    };
    const observer = new MutationObserver(refresh);
    const start = () => {
        refresh();
        observer.observe(list, { childList: true, subtree: true, characterData: true });
    };
    const stop = () => observer.disconnect();
    const destroy = () => {
        stop();
        view.removeEventListener('viewshow', start);
        view.removeEventListener('viewbeforehide', stop);
        view.removeEventListener('viewdestroy', destroy);
    };
    view.addEventListener('viewshow', start);
    view.addEventListener('viewbeforehide', stop);
    view.addEventListener('viewdestroy', destroy);
    start();
};
