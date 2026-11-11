import { useLayoutEffect, useState, type RefObject } from 'react';

/** The existing track guide threshold: 17.8 + 13.2 + 11.7em and the two .382em separations. */
export const trackStacks = (node: HTMLElement) => {
    const root = node.closest('.jfds');
    // Computer, phone and tablet draw the quiet controls, which never stack (the user, 2026-11-07 and 2026-11-11); the TV's strip may.
    if (root?.matches('.jfds:not(.layout-tv)')) return false;
    return node.clientWidth < (31 + 11.7 + 2 * 0.382) * parseFloat(getComputedStyle(node).fontSize);
};

export const useStacked = (ref: RefObject<HTMLElement>, device: unknown, enabled = true) => {
    const [stacked, setStacked] = useState(false);
    useLayoutEffect(() => {
        const update = () => {
            if (ref.current) setStacked(trackStacks(ref.current));
        };

        update();
        // eslint-disable-next-line compat/compat -- Chromium 79 supports ResizeObserver; older engines keep the resize fallback.
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        if (ref.current) observer?.observe(ref.current);
        window.addEventListener('resize', update);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [ref, device, enabled]);
    return stacked;
};
