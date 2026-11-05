/* eslint-disable @typescript-eslint/naming-convention -- upstream material icon IDs are an external API. */
/* eslint-disable react/no-array-index-key -- the imperative API mounts one immutable option list per root. */
import React, { type FC, useContext, useLayoutEffect, useRef } from 'react';
import dialogHelper from 'components/dialogHelper/dialogHelper';
import type { Options } from 'components/actionSheet/actionSheet';
import globalize from 'lib/globalize';
import { DesignContext } from './Root';
import { Button } from './Controls';
import { icons } from './icons';
import { menuIcons } from './menuIcons';
import { mountDialog } from './dialogHost';
import { menuPosition } from './menuPosition';
import { Icon } from './Icon';
import { titleCase } from './titleModel';

const aliases: Record<string, string> = {
    play_arrow: 'play', play_circle: 'play', shuffle: 'shuffle', playlist_add: 'add', add: 'add',
    collections: 'coll', library_add: 'coll', link: 'link', file_download: 'download', download: 'download',
    edit: 'edit', info: 'info', refresh: 'refresh', star: 'star', schedule: 'clock', timer: 'clock',
    delete: 'trash', delete_forever: 'trash', dashboard: 'dash', arrow_back: 'back', settings: 'gear',
    aspect_ratio: 'ratio', speed: 'speed', high_quality: 'hd', assessment: 'stats', repeat: 'repeat',
    subtitles: 'subs', audiotrack: 'audio', cloud_download: 'cloud', photo: 'image', image: 'image',
    favorite: 'heart', person: 'person', check: 'check', close: 'close', stop: 'close', swap_horiz: 'swap'
};
const paths: Record<string, string> = { ...icons, ...menuIcons, download: menuIcons.down };
const playerIcons: Record<string, string> = { aspectratio: 'ratio', playbackrate: 'speed', quality: 'hd', repeatmode: 'repeat', suboffset: 'subs', subtitleappearance: 'subs', stats: 'stats' };

export const MenuIcon: FC<{ name: string }> = ({ name }) => <svg viewBox='0 0 24 24' aria-hidden='true'><path d={paths[aliases[name] || name] || menuIcons.info} /></svg>;

const Sheet: FC<{ options: Options;
    choose: (id: string | null) => void }> = ({ options, choose }) => {
    const phone = useContext(DesignContext) === 'phone';
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (ref.current?.closest('.opened')) ref.current.classList.add('open');
    }, [phone]);
    const items = Array.from(options.items);
    const ordered = [...items.filter(item => item.id !== 'delete'), ...items.filter(item => item.id === 'delete')];
    return <div ref={ref} className={'pmenu focuscontainer-y ' + (phone ? 'sheet bottom msheet' : 'mn from-top')} role='menu' aria-label={options.title || 'Menu'} data-ds-actionsheet=''>
        {phone && <span className='sgrab' />}
        {options.title && <span className='cap0'>{options.title}</span>}
        {options.titleButton && <><div className='mi focusable' role='menuitem' tabIndex={0} aria-label={options.titleButton.title}
            ref={node => node?.setAttribute('autofocus', '')}
            onClick={() => choose(options.titleButton?.id || null)} onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.click();
            }}>
            <MenuIcon name={options.titleButton.icon} /><span className='tx0'>{options.titleButton.title}</span></div><div className='mhr' /></>}
        {options.text && <p className='mnote'>{options.text}</p>}
        {ordered.map((item, index) => item.divider ? <div className='mhr' key={index} /> :
            <div key={index} className={`mi focusable${item.selected ? ' sel' : ''}${item.disabled ? ' dim' : ''}${item.id === 'delete' ? ' redrow' : ''}`}
                role='menuitem' tabIndex={0} data-id={item.id == null || item.id === '' ? item.value : item.id} ref={node => {
                    if (item.selected && !options.titleButton) node?.setAttribute('autofocus', '');
                }}
                aria-disabled={item.disabled} title={item.title} onClick={() => {
                    const id = item.id == null || item.id === '' ? item.value : item.id;
                    if (!item.disabled) choose(id == null ? null : String(id));
                }}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.currentTarget.click();
                    }
                }}>
                {(item.icon || playerIcons[item.id || '']) && !(item.icon === 'check' && item.selected) && <MenuIcon name={item.icon || playerIcons[item.id || '']} />}
                <span className='tx0'>{titleCase(item.name || item.textContent || item.innerText || '')}{item.secondaryText && <small>{item.secondaryText}</small>}</span>
                {item.asideText && <span className='sub'>{item.asideText}</span>}
                {['aspectratio', 'playbackrate', 'quality', 'repeatmode'].includes(item.id || '') && <Icon name='right' className='nx' />}
            </div>)}
        {options.showCancel && <Button onClick={() => choose(null)}>{globalize.translate('ButtonCancel')}</Button>}
    </div>;
};

/** Same actionSheet contract, including resolveOnClick, timeout, cancellation and callback timing. */
export const showDesignSheet = (options: Options) => {
    const dlg = dialogHelper.createDialog({ removeOnClose: true, scrollY: false, enableHistory: options.enableHistory });
    const anchor = options.positionTo || document.activeElement;
    let selected: string | null = null;
    let closing = false;
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise<string | null>((resolve, reject) => {
        const choose = (id: string | null) => {
            if (closing) return;
            selected = id;
            if (id !== null && options.resolveOnClick && (!Array.isArray(options.resolveOnClick) || options.resolveOnClick.includes(id))) {
                resolved = true;
                resolve(id);
            }
            dialogHelper.close(dlg);
        };
        mountDialog(dlg, <Sheet options={options} choose={choose} />, () => dialogHelper.close(dlg), true);
        dlg.addEventListener('closing', () => {
            closing = true;
        });
        dlg.addEventListener('close', () => {
            clearTimeout(timer);
            if (resolved) return;
            if (selected === null) {
                reject(new Error('ActionSheet closed without resolving'));
            } else {
                options.callback?.(selected);
                resolve(selected);
            }
        }, { once: true });
        dlg.addEventListener('open', () => {
            const position = () => {
                const root = dlg.querySelector<HTMLElement>('.jfds');
                const sheet = dlg.querySelector<HTMLElement>('.pmenu');
                if (!root || !sheet) return;
                if (root.classList.contains('dev-phone')) {
                    sheet.style.removeProperty('top');
                    sheet.style.removeProperty('left');
                } else if (anchor) {
                    const pos = menuPosition(anchor, sheet);
                    sheet.style.top = pos.top + 'px';
                    sheet.style.left = pos.left + 'px';
                }
                const backdrop = (dlg as HTMLElement & { backdrop?: HTMLElement }).backdrop;
                if (backdrop) backdrop.style.opacity = root.classList.contains('dev-phone') ? '0.618' : '0';
            };
            position();
            window.addEventListener('resize', position);
            const observer = new MutationObserver(position);
            const root = dlg.querySelector('.jfds');
            if (root) observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
            dlg.addEventListener('close', () => {
                window.removeEventListener('resize', position);
                observer.disconnect();
            }, { once: true });
        }, { once: true });
        if (options.timeout) timer = setTimeout(() => dialogHelper.close(dlg), options.timeout);
        void dialogHelper.open(dlg).catch(reject);
    });
};

/* eslint-enable react/no-array-index-key */
/* eslint-enable @typescript-eslint/naming-convention */
