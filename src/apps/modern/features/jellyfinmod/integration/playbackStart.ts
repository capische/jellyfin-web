import loading from 'components/loading/loading';
import Events from 'utils/events';
import './playbackStart.scss';

let dismiss: (() => void) | undefined;

/** Keep the upstream start promise/result, including its rejection. No playback or routing decisions live here. */
export const withPlaybackStart = async <T>(manager: object, local: boolean, start: () => Promise<T>): Promise<T> => {
    const root = document.documentElement;
    if (!local || !root.classList.contains('jfmod-chrome') || root.classList.contains('jfmod-chromePlayer')) return start();
    dismiss?.();
    const screen = document.createElement('div');
    screen.className = 'jfmod-playbackStart';
    screen.setAttribute('aria-hidden', 'true');
    document.body.appendChild(screen);
    root.classList.add('jfmod-startingPlayback');
    loading.show();
    const events = ['playbackstart', 'playbackerror', 'playbackcancelled', 'playbackstop'];
    const close = () => {
        screen.remove();
        if (dismiss !== close) return;
        dismiss = undefined;
        root.classList.remove('jfmod-startingPlayback');
        loading.hide();
        events.forEach(event => {
            Events.off(manager, event, close);
        });
        window.removeEventListener('hashchange', close);
        window.removeEventListener('popstate', close);
        window.removeEventListener('pagehide', close);
    };
    dismiss = close;
    events.forEach(event => {
        Events.on(manager, event, close);
    });
    window.addEventListener('hashchange', close);
    window.addEventListener('popstate', close);
    window.addEventListener('pagehide', close);
    try {
        return await start();
    } finally {
        // Also covers early failures (before playInternal), resolved refusals and players with no start event.
        close();
    }
};
