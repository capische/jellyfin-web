import React, { type FC, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/** ds2.js pendingEl, with the approved D236 three-line exception inside lists under 24em. */
export const Pending: FC<{ mark: ReactNode; quality: string; marks: ReactNode; size?: string; state: ReactNode; flag?: string | null; action: ReactNode; id: string }> = ({ mark, quality, marks, size, state, flag, action, id }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        const node = ref.current;
        const list = node?.closest<HTMLElement>('.vlist');
        if (!node || !list) return;
        const update = () => setNarrow(list.clientWidth < 24 * parseFloat(getComputedStyle(node).fontSize));
        update();
        // eslint-disable-next-line compat/compat -- ResizeObserver is available on the supported Chromium 79 TV; resize remains a fallback.
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        observer?.observe(list);
        window.addEventListener('resize', update);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', update);
        };
    }, []);
    return <div ref={ref} className={'pend' + (narrow ? ' narrow' : '')} data-jfmod-pending={id}>
        {mark}<div className='pb'><div className='l1'><span className='r'>{quality}</span>{marks}{size && <span className='sz2'>{size}</span>}</div>
            <div className='l2'>{state}{flag && <span className='flag'>{narrow ? flag : '· ' + flag}</span>}</div></div>{action}
    </div>;
};
