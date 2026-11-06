import { createContext, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';

import './rowMotion.scss';

type Refresh = () => Promise<unknown>;
/** `leaving`: the native item id an action is about to take out of the row (a card marked watched), which starts to leave at once. */
export const RowRefreshContext = createContext<(refresh: Refresh, leaving?: string) => Promise<void>>(async refresh => {
    await refresh();
});

type Snapshot = { children: ReactNode; phase: 'waiting' | 'ready' | 'leave' | 'move' | 'moving' };
const cellsIn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('.cell[data-id]'));
const duration = (root: HTMLElement, token: string, fallback: number) => {
    const value = getComputedStyle(root).getPropertyValue(token).trim();
    if (!value) return fallback;
    return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
};

/** Hold the old React cards until an action's refetch answers, then leave and FLIP by native item id. */
export const useRowMotion = (children: ReactNode, ids?: string[], ready = true) => {
    const root = useRef<HTMLDivElement>(null);
    const incoming = useRef(children);
    incoming.current = children;
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const positions = useRef(new Map<string, number>());
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const pending = useRef(0);
    const failed = useRef(false);
    const mounted = useRef(false);
    const focus = useRef<{ id: string; index: number }>();
    // Cards that started to leave on the click, and when, so the swap waits only for what is left of their fade.
    const early = useRef(new Map<string, number>());

    const clear = useCallback(() => {
        clearTimeout(timer.current);
        if (!root.current) return;
        cellsIn(root.current).forEach(cell => {
            cell.classList.remove('jfmod-rowLeave', 'jfmod-rowMove', 'jfmod-rowEnter');
            early.current.delete(cell.dataset.id!);
            cell.style.removeProperty('transform');
            cell.style.removeProperty('opacity');
        });
    }, []);

    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            clear();
        };
    }, [clear]);

    const refresh = useCallback(async (reload: Refresh, leaving?: string) => {
        // First look: computer only. TV and reduced motion keep the existing instant update.
        if (!ids || !root.current?.closest('.dev-computer') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            await reload();
            return;
        }
        if (!pending.current) {
            clear();
            failed.current = false;
            setSnapshot({ children: incoming.current, phase: 'waiting' });
        }
        // The server's next row can take seconds (Next Up); the card the click takes out leaves now rather than then.
        const cell = leaving ? cellsIn(root.current).find(value => value.dataset.id === leaving) : undefined;
        if (cell && leaving) {
            early.current.set(leaving, Date.now());
            cell.classList.add('jfmod-rowLeave');
        }
        pending.current++;
        try {
            await reload();
        } catch (error) {
            failed.current = true;
            throw error;
        } finally {
            pending.current--;
            if (mounted.current && !pending.current) {
                if (failed.current) {
                    clear();
                    setSnapshot(null);
                } else {
                    // The row may already have moved on its own feeds' answer (below); only a row still waiting is told.
                    setSnapshot(previous => previous?.phase === 'waiting' ? { ...previous, phase: 'ready' } : previous);
                }
            }
        }
    }, [ids, clear]);

    useLayoutEffect(() => {
        const element = root.current;
        if (!element || !snapshot) return;
        // The whole Home refetches after an action, the hero's checks included; the row moves as soon as its own feeds have
        // answered with other cards rather than when every query has (the user: "black area stays for couple seconds").
        const answered = snapshot.phase === 'waiting' && cellsIn(element).map(cell => cell.dataset.id).join(',') !== ids?.join(',');
        if ((snapshot.phase === 'ready' || answered) && ready) {
            const old = cellsIn(element);
            const next = new Set(ids);
            if (old.map(cell => cell.dataset.id).join(',') === ids?.join(',')) {
                // A card that started to leave but stays (the row still holds it) comes back.
                clear();
                setSnapshot(null);
                return;
            }
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                clear();
                setSnapshot(null);
                return;
            }
            positions.current = new Map(old.map(cell => [cell.dataset.id!, cell.getBoundingClientRect().left]));
            const focused = old.findIndex(cell => cell.contains(document.activeElement));
            focus.current = focused >= 0 ? { id: old[focused].dataset.id!, index: focused } : undefined;
            const leaving = old.filter(cell => !next.has(cell.dataset.id!));
            // A card that started to leave on the click but stays comes back.
            old.filter(cell => next.has(cell.dataset.id!)).forEach(cell => {
                cell.classList.remove('jfmod-rowLeave');
                early.current.delete(cell.dataset.id!);
            });
            const leaveFor = duration(element, '--d1', 236);
            const started = Math.min(Date.now(), ...leaving.map(cell => early.current.get(cell.dataset.id!) ?? Date.now()));
            leaving.forEach(cell => {
                // Chromium 79 has no inert: remove each outgoing card and its pill from keyboard navigation.
                cell.tabIndex = -1;
                cell.querySelectorAll<HTMLElement>('[tabindex]').forEach(control => {
                    control.tabIndex = -1;
                });
                cell.classList.add('jfmod-rowLeave');
            });
            const swap = () => setSnapshot({ children: incoming.current, phase: 'move' });
            if (leaving.length) {
                setSnapshot(previous => previous && { ...previous, phase: 'leave' });
                timer.current = setTimeout(swap, Math.max(0, leaveFor - (Date.now() - started)));
            } else {
                swap();
            }
        } else if (snapshot.phase === 'move') {
            const cards = cellsIn(element);
            const moved: HTMLElement[] = [];
            cards.forEach(cell => {
                const before = positions.current.get(cell.dataset.id!);
                if (before === undefined) {
                    cell.style.opacity = '0';
                    cell.style.transform = 'translateX(-1.618em)';
                    moved.push(cell);
                } else {
                    const dx = before - cell.getBoundingClientRect().left;
                    if (dx) {
                        cell.style.transform = `translateX(${dx}px)`;
                        moved.push(cell);
                    }
                }
            });
            // Commit inverse positions before enabling transitions; no Animation.finished on webOS 6.
            element.getBoundingClientRect();
            moved.forEach(cell => {
                cell.classList.add(positions.current.has(cell.dataset.id!) ? 'jfmod-rowMove' : 'jfmod-rowEnter');
                cell.style.removeProperty('transform');
                cell.style.removeProperty('opacity');
            });
            setSnapshot(previous => previous && { ...previous, phase: 'moving' });
            timer.current = setTimeout(() => {
                clear();
                const previous = focus.current;
                if (previous && !cards.some(cell => cell.dataset.id === previous.id)) {
                    (cards.find(cell => !positions.current.has(cell.dataset.id!)) || cards[previous.index] || cards[cards.length - 1])?.focus();
                }
                setSnapshot(null);
            }, duration(element, '--d2', 382));
        }
    }, [snapshot, ready, ids, clear]);

    return { root, refresh, active: !!snapshot, content: snapshot ? snapshot.children : children };
};
