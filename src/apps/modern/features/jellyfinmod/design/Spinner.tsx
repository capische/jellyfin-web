import React, { type FC } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Root } from './Root';
import { hasDesignPage } from './dialogHost';

/** DS.spinner and layer, including upstream's four arc layers and composited motion. */
export const Spinner: FC = () => <div dir='ltr' className='docspinner mdl-spinner mdlSpinnerActive' role='status' aria-label='Loading'>
    {[1, 2, 3, 4].map(index => <div key={index} className={`mdl-spinner__layer mdl-spinner__layer-${index}`}>
        <div className='mdl-spinner__circle-clipper mdl-spinner__left'><div className='mdl-spinner__circle mdl-spinner__circleLeft' /></div>
        <div className='mdl-spinner__circle-clipper mdl-spinner__right'><div className='mdl-spinner__circle mdl-spinner__circleRight' /></div>
    </div>)}
</div>;

let mount: { host: HTMLElement; root: ReactRoot; observer: MutationObserver } | undefined;
export const hideDesignLoading = () => {
    if (!mount) return;
    mount.observer.disconnect();
    mount.root.unmount();
    mount.host.remove();
    mount = undefined;
};
export const showDesignLoading = (onLeave: () => void) => {
    if (!hasDesignPage()) return false;
    if (!mount) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const observer = new MutationObserver(() => {
            if (!hasDesignPage()) onLeave();
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        mount = { host, root, observer };
        flushSync(() => root.render(<Root className='loadingportal'><Spinner /></Root>));
    }
    return true;
};
