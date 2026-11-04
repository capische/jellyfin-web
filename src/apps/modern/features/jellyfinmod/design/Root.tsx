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
    return { device, theme: html.dataset.theme || 'dark', layout, noBlur };
};

export const DesignContext = createContext<Device | false>(false);

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
    return <DesignContext.Provider value={env.device}><div ref={ref} className={`jfds dev-${env.device} layout-${env.layout}${env.noBlur ? ' no-bf' : ''} ${className}`} data-theme={env.theme}>{children}</div></DesignContext.Provider>;
};
