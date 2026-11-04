import React, { type FC, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { appHost } from 'components/apphost';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { AppFeature } from 'constants/appFeature';
import { useApi } from 'hooks/useApi';
import { useQuickConnectEnabled } from 'hooks/useQuickConnect';
import { useUsers } from 'hooks/useUsers';
import globalize from 'lib/globalize';
import browser from 'scripts/browser';
import keyboardNavigation from 'scripts/keyboardNavigation';
import shell from 'scripts/shell';
import Dashboard from 'utils/dashboard';
import { Icon, type IconName } from './Icon';
import { Root } from './Root';

interface RowProps { icon: IconName; title: string; desc?: string; href?: string; onClick?: () => void }

/** ds.js setRow with its chevron; a link or a button takes the same row. */
const Row: FC<RowProps> = ({ icon, title, desc, href, onClick }) => <a className='srow2 focusable' href={href ?? '#'} onClick={onClick && (event => {
    event.preventDefault();
    onClick();
})}><span className='tilei'><Icon name={icon} /></span><span className='tx'><b>{title}</b>{desc && <small>{desc}</small>}</span><span className='ctl'><Icon name='right' className='go' /></span></a>;

/** ds.js prefs-menu: every destination and condition of upstream's user settings page. */
export const PrefsMenu: FC = () => {
    const { user: currentUser } = useApi();
    const [searchParams] = useSearchParams();
    const { data: quickConnect } = useQuickConnectEnabled();
    const { data: users } = useUsers();
    const userId = searchParams.get('userId') || currentUser?.Id;
    const loggedIn = !!userId && userId === currentUser?.Id;
    const user = useMemo(() => (loggedIn ? currentUser : users?.find(({ Id }) => Id === userId)), [currentUser, loggedIn, userId, users]);
    useEffect(() => {
        if (!layoutManager.tv) return;
        const first = document.querySelector<HTMLElement>('#jfmodPrefsMenu .srow2');
        if (first) focusManager.focus(first);
    }, [user?.Id]);
    if (!user) return null;
    const image = user.PrimaryImageTag && `/Users/${user.Id}/Images/Primary?tag=${user.PrimaryImageTag}&quality=90&maxHeight=200`;
    const query = `?userId=${userId}`;
    return <Page id='jfmodPrefsMenu' title={globalize.translate('Settings')} className='mainAnimatedPage libraryPage noSecondaryNavPage jfmod-dsPage jfmod-dsPrefsReact'>
        <Root><div className='pcol plain'>
            <div className='mhead'><span className='avatar2'>{image ? <img src={image} alt='' /> : <Icon name='person' />}</span><span className='nm'>{user.Name}</span></div>
            <div className='scard'>
                <Row icon='person' title={globalize.translate('Profile')} desc='Your picture and password' href={'#/userprofile' + query} />
                {quickConnect && <Row icon='qc' title={globalize.translate('QuickConnect')} desc='Sign in another device with a code' href={'#/quickconnect' + query} />}
                <Row icon='display' title={globalize.translate('Display')} desc='Language, layout and theme' href={'#/mypreferencesdisplay' + query} />
                <Row icon='home' title={globalize.translate('Home')} desc='What Home shows, in which order' href={'#/mypreferenceshome' + query} />
                <Row icon='play' title={globalize.translate('TitlePlayback')} desc='Audio, quality and the next episode' href={'#/mypreferencesplayback' + query} />
                <Row icon='subs' title={globalize.translate('Subtitles')} desc='Language, mode and how they look' href={'#/mypreferencessubtitles' + query} />
                {appHost.supports(AppFeature.DownloadManagement) && <Row icon='arrow' title={globalize.translate('DownloadManager')} onClick={shell.openDownloadManager} />}
                {appHost.supports(AppFeature.ClientSettings) && <Row icon='gear' title={globalize.translate('ClientSettings')} onClick={shell.openClientSettings} />}
                {loggedIn && !browser.mobile && (keyboardNavigation.canEnableGamepad() || layoutManager.tv) && <Row icon='ctrl' title={globalize.translate('Controls')} desc='The remote and the gamepad' href={'#/mypreferencescontrols' + query} />}
            </div>
            {loggedIn && user.Policy?.IsAdministrator && !layoutManager.tv && <div className='scard' style={{ marginTop: '1em' }}>
                <Row icon='dash' title={globalize.translate('TabDashboard')} href='#/dashboard' />
                <Row icon='edit' title={globalize.translate('MetadataManager')} href='#/metadata' />
            </div>}
            {loggedIn && <div className='scard' style={{ marginTop: '1em' }}>
                {appHost.supports(AppFeature.MultiServer) && <Row icon='swap' title={globalize.translate('SelectServer')} onClick={Dashboard.selectServer} />}
                <Row icon='out' title={globalize.translate('ButtonSignOut')} desc='Leave this device' onClick={Dashboard.logout} />
                {appHost.supports(AppFeature.ExitMenu) && <Row icon='close' title={globalize.translate('ButtonExitApp')} onClick={appHost.exit} />}
            </div>}
        </div></Root>
    </Page>;
};
