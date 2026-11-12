import React, { type FC, type PropsWithChildren, useLayoutEffect, useState, createContext, useRef } from 'react';
import browser from 'scripts/browser';
import './design.scss';
import './cardRatings.scss';
import './titleTop.scss';
import './ratingLinks.scss';
import './progressRatings.scss';

export type Device = 'computer' | 'tablet' | 'phone' | 'tv';

/** Observe the app's actual theme/layout markers, including changes made without navigation. */
export const readEnvironment = () => {
    const html = document.documentElement;
    const tv = html.classList.contains('layout-tv');
    const mobile = html.classList.contains('layout-mobile');
    let device: Device = window.innerWidth < 900 ? 'tablet' : 'computer';
    // A computer window narrowed to a phone's width takes the phone's page, or the bar runs off the side.
    if (window.innerWidth < 600) device = 'phone';
    let layout = 'desktop';
    if (mobile) {
        device = 'phone';
        layout = 'mobile';
    }
    if (tv) {
        device = 'tv';
        layout = 'tv';
    }
    // eslint-disable-next-line compat/compat -- capability detection selects the solid recipe on older webOS.
    const noBlur = !(window.CSS?.supports?.('backdrop-filter', 'blur(1px)') && window.CSS?.supports?.('color', 'color-mix(in srgb, #000 50%, transparent)'));
    return { device, theme: html.classList.contains('jfmod-chromePlayer') ? 'dark' : html.dataset.theme || 'dark', layout, noBlur };
};

export const DesignContext = createContext<Device | false>(false);

/** ds.t19's quiet track controls and one chooser: computer, phone and tablet (the user, 2026-11-11); the TV keeps its strip. */
export const quietTracks = (device: Device | false) => !!device && device !== 'tv';

/** The quiet track controls' closed look (icon, value, chevron) on every layout, the TV too (the user, 2026-11-18: "I also
 * expected TV to have the same video audio and subtitle dropdowns"); the TV's lists stay its own (`quietTracks`). */
export const quietLook = (device: Device | false) => !!device;

/** The newest webOS that keeps the dark TV glass in the light theme: webOS 6 (Chromium 79, the user's C1) and earlier, by the
 * platform version upstream reads from the engine (`browser.web0sVersion`), never the TV model (the user, 2026-11-18). */
export const LEGACY_WEBOS_MAX_VERSION = 6;

// A click also moves focus, and a dialog focuses a control when a click opens it; the mockup's rings are for keys and the TV.
if (typeof document !== 'undefined') {
    // An unknown webOS version (NetCast) counts as old.
    if (browser.web0s && (browser.web0sVersion ?? 0) <= LEGACY_WEBOS_MAX_VERSION) document.documentElement.classList.add('jfmod-webos-legacy');
    document.addEventListener('pointerdown', () => document.documentElement.classList.add('ds-pointer'), true);
    document.addEventListener('keydown', () => document.documentElement.classList.remove('ds-pointer'), true);
}

const buttonFocus = (target: EventTarget | null, focusedOn?: Device) => {
    if (!(target instanceof HTMLElement)) return;
    const device = focusedOn !== 'tv' && document.documentElement.classList.contains('ds-pointer') ? undefined : focusedOn;
    if (target.classList.contains('sw') || target.classList.contains('tab')) {
        target.classList.toggle('tvf', device === 'tv');
        return;
    }
    if (target.classList.contains('rb')) {
        target.classList.toggle('foc', !!device);
        return;
    }
    if (!target.classList.contains('btn')) return;
    target.classList.remove('kf', 'tvf');
    if (device) target.classList.add(device === 'tv' ? 'tvf' : 'kf');
};

const clearPhoneFocus = (root: HTMLElement | null) => {
    root?.querySelectorAll('.cell.focus, .cell.lit').forEach(cell => {
        cell.classList.remove('focus', 'lit');
    });
};

/** Context for controllers whose React content is portaled into the painted design root. */
export const DesignEnvironment: FC<PropsWithChildren> = ({ children }) => {
    const [env, setEnv] = useState(readEnvironment);
    useLayoutEffect(() => {
        const update = () => setEnv(readEnvironment());
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
        };
    }, []);
    return <DesignContext.Provider value={env.device}>{children}</DesignContext.Provider>;
};

/** A touch tablet (iPadOS Safari's desktop-class user agent under 900 px wide) draws a page that asks for it as the computer's
 * (the title page, the user 2026-11-19: tablets get the redesign; the phone keeps its page). */
// eslint-disable-next-line compat/compat -- capability detection: an engine without it is no touch tablet.
const asComputer = (device: Device) => (device === 'tablet' && navigator.maxTouchPoints > 0 ? 'computer' : device);

export const Root: FC<PropsWithChildren<{ className?: string; tabletAsComputer?: boolean }>> = ({ children, className = '', tabletAsComputer }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [raw, setEnv] = useState(readEnvironment);
    const env = tabletAsComputer ? { ...raw, device: asComputer(raw.device) } : raw;
    useLayoutEffect(() => {
        const update = () => setEnv(previous => {
            const next = readEnvironment();
            if (next.device === 'phone' && previous.device !== 'phone') {
                clearPhoneFocus(ref.current);
            }
            return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
        });
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
        };
    }, []);
    useLayoutEffect(() => {
        if (ref.current?.contains(document.activeElement)) buttonFocus(document.activeElement, env.device);
    }, [env.device]);
    return <DesignContext.Provider value={env.device}><div ref={ref} className={`jfds dev-${env.device} layout-${env.layout}${env.noBlur ? ' no-bf' : ''} ${className}`} data-theme={env.theme}
        onFocusCapture={event => buttonFocus(event.target, env.device)} onBlurCapture={event => buttonFocus(event.target)}>{children}</div></DesignContext.Provider>;
};
