import type { DownloadProgress } from '../constants/queue';
import { paintLink, type DownloadMarkLink } from '../components/DownloadStateMark';

// ds2.js dm, card size. Progress, state, client URL and permission all come from the existing integration.
const painted = new WeakMap<HTMLElement, string>();

const glyphs: Record<string, string> = {
    downloading: '<path d="M12 4V20M6 14L12 20L18 14"/>',
    plus: '<path d="M12 5.5V18.5M5.5 12H18.5"/>',
    queued: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12L15 14"/>',
    stalled: '<path d="M9 6V18M15 6V18"/>',
    failed: '<path d="M12 4.6V12.6" stroke-width="4.4"/><circle cx="12" cy="19" r="2.2" fill="currentColor" stroke="none"/>',
    seeding: '<path d="M12 20V7M6.5 12.5L12 7L17.5 12.5"/>'
};

export const paintCellDownload = (cell: HTMLElement, progress: DownloadProgress | null, link: DownloadMarkLink | null) => {
    const post = cell.querySelector<HTMLElement>('.post');
    if (!post) return;
    let mark = post.querySelector<HTMLElement>('[data-ds-download]');
    let bar = post.querySelector<HTMLElement>('[data-ds-progress]');
    cell.classList.toggle('ds-downloading', !!progress);
    if (!progress) {
        mark?.remove();
        bar?.remove();
        return;
    }
    if (!mark) {
        mark = document.createElement('span');
        mark.dataset.dsDownload = '';
        mark.className = 'cmark glassy';
        (post.querySelector('.corner') ?? post).append(mark);
    }
    const kind = progress.kind;
    const turning = kind === 'importing';
    const hasArc = turning || ['downloading', 'stalled', 'seeding'].includes(kind);
    let arc = '';
    if (hasArc) {
        const segment = turning ? '28 72' : `${progress.percent ?? 0} 100`;
        arc = '<svg class="arc" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--card-track)" stroke-width="2.6"/>'
            + `<circle class="${turning ? 'turn' : 'val'}" cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" pathLength="100" stroke-dasharray="${segment}"/></svg>`;
    }
    const glyph = progress.plus ? glyphs.plus : glyphs[kind] || glyphs.downloading;
    const state = progress.plus && kind === 'downloading' ? 'new-version' : kind;
    const html = `<span class="dm card ${state}">${arc}<svg class="glyph${kind === 'downloading' && !progress.plus ? ' bob' : ''}" viewBox="0 0 24 24" style="fill:none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg></span>`;
    if (painted.get(mark) !== html) {
        mark.innerHTML = html;
        painted.set(mark, html);
    }
    mark.dataset.jfmodKind = kind;
    paintLink(mark, progress.tooltip, link);
    if (!bar) {
        bar = document.createElement('span');
        bar.dataset.dsProgress = '';
        bar.className = 'prog';
        bar.innerHTML = '<i class="dl"></i>';
        post.append(bar);
    }
    bar.querySelector<HTMLElement>('i')!.style.width = `${progress.percent ?? 0}%`;
};
