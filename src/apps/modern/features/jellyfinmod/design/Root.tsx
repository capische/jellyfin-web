import React, { type FC, type PropsWithChildren, useLayoutEffect, useState, createContext, useRef } from 'react';
import './design.scss';

export type Device = 'computer' | 'tablet' | 'phone' | 'tv';

/** Observe the app's actual theme/layout markers, including changes made without navigation. */
const readEnvironment = () => {
    const html = document.documentElement;
    const tv = html.classList.contains('layout-tv');
    const mobile = html.classList.contains('layout-mobile');
    let device: Device = window.innerWidth < 900 ? 'tablet' : 'computer';
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

const buttonFocus = (target: EventTarget | null, device?: Device) => {
    if (!(target instanceof HTMLElement)) return;
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

export const Root: FC<PropsWithChildren<{ className?: string }>> = ({ children, className = '' }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [env, setEnv] = useState(readEnvironment);
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
