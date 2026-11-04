import { DesignMenus } from './MenuPresentation';
import React, { type FC, type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { getKeyName } from 'scripts/keyboardNavigation';
import { useLocation } from 'react-router-dom';
import { SyncPlayUserAccessType } from '@jellyfin/sdk/lib/generated-client/models/sync-play-user-access-type';
import { useApi } from 'hooks/useApi';
import { useUserViews } from 'hooks/api/useUserViews';
import { useWebConfig } from 'hooks/useWebConfig';
import { appRouter } from 'components/router/appRouter';
import { playbackManager } from 'components/playback/playbackmanager';
import { pluginManager } from 'components/pluginManager';
import { PluginType } from 'constants/pluginType';
import Events from 'utils/events';
import { useSyncPlayGroups, QUERY_KEY } from 'apps/modern/features/syncPlay/hooks/api/useSyncPlayGroups';
import { queryClient } from 'utils/query/queryClient';
import RemotePlayMenu from 'apps/modern/components/AppToolbar/menus/RemotePlayMenu';
import RemotePlayActiveMenu from 'apps/modern/components/AppToolbar/menus/RemotePlayActiveMenu';
import SyncPlayMenu from 'apps/modern/components/AppToolbar/menus/SyncPlayMenu';
import AppUserMenu from 'components/toolbar/AppUserMenu';
import BarSearch from './BarSearch';
import { Root } from './Root';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';

const isFavorites = (pathname: string, search: string) => pathname === '/favorites' || pathname === '/home' && new URLSearchParams(search).get('tab') === '1';
const pageTitles = new Map([['/tv', 'Shows'], ['/movies', 'Movies']]);

const activate = (event: KeyboardEvent<HTMLElement>) => {
    if (getKeyName(event.nativeEvent) !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.click();
};

const ComputerNavigation: FC = () => {
    const { pathname, search } = useLocation();
    const { data: views } = useUserViews();
    const { menuLinks } = useWebConfig();
    const [more, setMore] = useState(false);
    const closeMore = useCallback(() => setMore(false), []);
    const favorites = isFavorites(pathname, search);
    const sorted = [...views?.Items ?? []].sort((a, b) => {
        const order = (type?: string | null) => {
            if (type === 'tvshows') return 0;
            if (type === 'movies') return 1;
            return 2;
        };
        return order(a.CollectionType) - order(b.CollectionType);
    });
    const primary = [sorted.find(view => view.CollectionType === 'tvshows'), sorted.find(view => view.CollectionType === 'movies')].filter(view => !!view);
    const remaining = sorted.filter(view => !primary.includes(view));
    return <>
        <a href='#/home' className='logo focusable' aria-label='Home' /><a href='#/home' className='name'>jellyfinmod</a>
        <span className='nav'>
            <a href='#/home?tab=1'><span className={favorites ? 'on' : ''}><Icon name='heart' />Favorites</span></a>
            {primary.map(view => {
                const viewPath = view.CollectionType === 'tvshows' ? '/tv' : '/movies';
                return <a key={view.Id} href={appRouter.getRouteUrl(view, { context: view.CollectionType })}>
                    <span className={pathname === viewPath ? 'on' : ''}>
                        <Icon name={view.CollectionType === 'tvshows' ? 'tv' : 'movie'} />{view.Name}</span></a>;
            })}
        </span>
        {(remaining.length > 0 || !!menuLinks?.length) && <span className='menuhost'>
            <span className='bic focusable' role='button' tabIndex={0} aria-label='More libraries' onClick={() => setMore(value => !value)}
                onKeyDown={activate}><Icon name='down' className='icon' /></span>
            {more && <Menu label='Libraries' close={closeMore}>
                {remaining.map(view => <a className='mi' key={view.Id} href={appRouter.getRouteUrl(view, { context: view.CollectionType })} onClick={closeMore}>{view.Name}</a>)}
                {menuLinks?.map(link => <a className='mi' key={link.url} href={link.url} target='_blank' rel='noopener noreferrer'>{link.name}</a>)}
            </Menu>}
        </span>}
    </>;
};

export const Bar: FC<{ onDrawer?: React.MouseEventHandler<HTMLElement> }> = ({ onDrawer }) => {
    const { pathname, search } = useLocation();
    const { user } = useApi();
    const [anchor, setAnchor] = useState<{ kind: string; el: HTMLElement } | null>(null);
    const close = useCallback(() => setAnchor(null), []);
    const [playerInfo, setPlayerInfo] = useState(playbackManager.getPlayerInfo());
    const [clock, setClock] = useState(new Date());
    const [tv, setTv] = useState(document.documentElement.classList.contains('layout-tv'));
    const [phone, setPhone] = useState(document.documentElement.classList.contains('layout-mobile'));
    const [scrolled, setScrolled] = useState(false);
    const { data: groups } = useSyncPlayGroups();
    useLayoutEffect(() => {
        // Home's retained tab strip needs the same space as the replacement bar above it.
        const header = document.querySelector<HTMLElement>('.skinHeader .headerTop');
        const bar = document.querySelector('.jfds .bar, .jfds .tvbar');
        if (!header || !bar) return;
        const { height, boxSizing } = header.style;
        header.style.height = `${bar.getBoundingClientRect().height}px`;
        header.style.boxSizing = 'border-box';
        return () => {
            header.style.height = height;
            header.style.boxSizing = boxSizing;
        };
    }, [tv, phone]);
    useEffect(() => {
        const header = document.querySelector<HTMLElement>('.skinHeader .headerTop');
        const previousVisibility = header?.style.visibility;
        if (header) header.style.visibility = 'hidden';
        const update = () => setPlayerInfo(playbackManager.getPlayerInfo());
        Events.on(playbackManager, 'playerchange', update);
        const timer = window.setInterval(() => setClock(new Date()), 30000);
        const layout = new MutationObserver(() => {
            setTv(document.documentElement.classList.contains('layout-tv'));
            setPhone(document.documentElement.classList.contains('layout-mobile'));
        });
        layout.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        const scroll = (event: Event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('.pmenu, .rowx, .MuiPopover-root')) return;
            setScrolled((target instanceof Element ? target.scrollTop : window.scrollY) > 0);
        };
        document.addEventListener('scroll', scroll, true);
        return () => {
            if (header) header.style.visibility = previousVisibility || '';
            Events.off(playbackManager, 'playerchange', update);
            clearInterval(timer);
            layout.disconnect();
            document.removeEventListener('scroll', scroll, true);
        };
    }, []);
    const open = (kind: string, el: HTMLElement) => {
        if (kind === 'sync') void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        setAnchor({ kind, el });
    };
    const sync = user?.Policy?.SyncPlayAccess !== SyncPlayUserAccessType.None && pluginManager.ofType(PluginType.SyncPlay).length > 0;
    const favorites = isFavorites(pathname, search);
    const onArt = ['/home', '/details'].includes(pathname) && !favorites;
    const title = favorites ? 'Favorites' : (pageTitles.get(pathname) || '');
    const iconLink = (icon: IconName, label: string, kind: string) => <span className='bic focusable' role='button' tabIndex={0}
        data-tip={label} aria-label={label} data-ds-menu={kind} onClick={event => open(kind, event.currentTarget)}
        onKeyDown={activate}><Icon name={icon} className='icon' /></span>;
    const syncLabel = groups?.length ? 'SyncPlay groups available' : 'SyncPlay';
    const syncControl = sync && iconLink('people', syncLabel, 'sync');
    let leading: ReactNode;
    if (tv) {
        leading = <>
            <button className='focusable' title='Back' onClick={() => { void appRouter.back(); }}><Icon name='back' /></button>
            <button className='focusable' title='Home' onClick={() => { window.location.hash = '#/home'; }}><Icon name='home' /></button>
            {title && <span className='ttl'>{title}</span>}
        </>;
    } else if (phone) {
        leading = <span className='focusable' role='button' tabIndex={0} aria-label='Open Menu' onClick={onDrawer}
            onKeyDown={activate}><Icon name='menu' className='menu' /></span>;
    } else {
        leading = <>
            {window.NativeShell && appRouter.canGoBack(pathname) && <span className='bic focusable' role='button' tabIndex={0}
                aria-label='Back' onClick={() => { void appRouter.back(); }} onKeyDown={activate}><Icon name='back' className='icon' /></span>}
            <ComputerNavigation />
        </>;
    }
    const scrollClass = scrolled ? ' glassbar' : '';
    const barClass = tv ? 'tvbar focuscontainer-x' : 'bar over focuscontainer-x' + scrollClass;
    return <>
        <Root className={'barroot' + (onArt ? ' onart' : '')}>
            <div className={barClass}>
                {leading}
                {!phone && <BarSearch />}
                <span className='spacer' />
                {syncControl}
                {iconLink('cast', playerInfo?.isLocalPlayer === false ? playerInfo.deviceName || playerInfo.name || 'Cast to Device' : 'Cast to Device', 'cast')}
                {phone && <a className='bic' href='#/search' title='Search'><Icon name='search' className='icon' /></a>}
                <span className='avatar focusable' role='button' tabIndex={0} aria-label='User Menu' aria-controls='app-user-menu' aria-haspopup='menu'
                    onClick={event => open('user', event.currentTarget)} onKeyDown={activate}><Icon name='person' /></span>
                {tv && <span className='clock'>{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
            </div>
        </Root>
        <DesignMenus.Provider value><SyncPlayMenu open={anchor?.kind === 'sync'} anchorEl={anchor?.el} onMenuClose={close} />
            {playerInfo && !playerInfo.isLocalPlayer ? <RemotePlayActiveMenu open={anchor?.kind === 'cast'} anchorEl={anchor?.el} onMenuClose={close} playerInfo={playerInfo} /> :
                <RemotePlayMenu open={anchor?.kind === 'cast'} anchorEl={anchor?.el} onMenuClose={close} />}
            <AppUserMenu open={anchor?.kind === 'user'} anchorEl={anchor?.el} onMenuClose={close} /></DesignMenus.Provider>
    </>;
};
