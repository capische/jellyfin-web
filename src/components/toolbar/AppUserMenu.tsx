import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from 'apps/modern/features/jellyfinmod/design/MenuPresentation';
import AccountCircle from '@mui/icons-material/AccountCircle';
import AppSettingsAlt from '@mui/icons-material/AppSettingsAlt';
import Close from '@mui/icons-material/Close';
import DashboardIcon from '@mui/icons-material/Dashboard';
import Download from '@mui/icons-material/Download';
import Downloading from '@mui/icons-material/Downloading';
import StarHalf from '@mui/icons-material/StarHalf';
import Tune from '@mui/icons-material/Tune';
import Edit from '@mui/icons-material/Edit';
import Logout from '@mui/icons-material/Logout';
import PhonelinkLock from '@mui/icons-material/PhonelinkLock';
import Settings from '@mui/icons-material/Settings';
import Storage from '@mui/icons-material/Storage';
import type { MenuProps } from '@mui/material/Menu';
import React, { FC, useCallback } from 'react';
import { Link } from 'react-router-dom';

import { useQueueVisible } from 'apps/modern/features/jellyfinmod/hooks/useQueue';
import { useRatingsPreferencesVisible, useSettingsVisible } from 'apps/modern/features/jellyfinmod/hooks/useSettingsVisible';
import { appHost } from 'components/apphost';
import { AppFeature } from 'constants/appFeature';
import { useApi } from 'hooks/useApi';
import { useQuickConnectEnabled } from 'hooks/useQuickConnect';
import globalize from 'lib/globalize';
import shell from 'scripts/shell';
import Dashboard from 'utils/dashboard';

export const ID = 'app-user-menu';

interface AppUserMenuProps extends MenuProps {
    onMenuClose: () => void
}

const AppUserMenu: FC<AppUserMenuProps> = ({
    anchorEl,
    open,
    onMenuClose
}) => {
    const { user } = useApi();
    const { data: isQuickConnectEnabled } = useQuickConnectEnabled();
    // JellyfinMod: the queue item, beside Profile and Settings (UX decision log, P5.I8).
    const isQueueVisible = useQueueVisible();
    // JellyfinMod: the settings area, for administrators of a plugin that offers it (P7.S8).
    const isSettingsVisible = useSettingsVisible();
    // JellyfinMod: every user's choice of rating sources, for a plugin that offers ratings (Phase 9).
    const isRatingsVisible = useRatingsPreferencesVisible();

    const onDownloadManagerClick = useCallback(() => {
        shell.openDownloadManager();
        onMenuClose();
    }, [ onMenuClose ]);

    const onClientSettingsClick = useCallback(() => {
        shell.openClientSettings();
        onMenuClose();
    }, [ onMenuClose ]);

    const onExitAppClick = useCallback(() => {
        appHost.exit();
        onMenuClose();
    }, [ onMenuClose ]);

    const onLogoutClick = useCallback(() => {
        Dashboard.logout();
        onMenuClose();
    }, [ onMenuClose ]);

    const onSelectServerClick = useCallback(() => {
        Dashboard.selectServer();
        onMenuClose();
    }, [ onMenuClose ]);

    return (
        <Menu
            anchorEl={anchorEl}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right'
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'right'
            }}
            id={ID}
            keepMounted
            open={open}
            onClose={onMenuClose}
        >
            <MenuItem
                component={Link}
                to={`/userprofile?userId=${user?.Id}`}
                onClick={onMenuClose}
            >
                <ListItemIcon icon='person'>
                    <AccountCircle />
                </ListItemIcon>
                <ListItemText>
                    {globalize.translate('Profile')}
                </ListItemText>
            </MenuItem>
            <MenuItem
                component={Link}
                to='/mypreferencesmenu'
                onClick={onMenuClose}
            >
                <ListItemIcon icon='gear'>
                    <Settings />
                </ListItemIcon>
                <ListItemText>
                    {globalize.translate('Settings')}
                </ListItemText>
            </MenuItem>
            {isQueueVisible && (
                <MenuItem
                    component={Link}
                    to='/catalog/queue'
                    onClick={onMenuClose}
                >
                    <ListItemIcon icon='arrow'>
                        <Downloading />
                    </ListItemIcon>
                    <ListItemText>
                        Queue
                    </ListItemText>
                </MenuItem>
            )}
            {isSettingsVisible && (
                <MenuItem
                    component={Link}
                    to='/catalog/settings'
                    onClick={onMenuClose}
                >
                    <ListItemIcon icon='gear'>
                        <Tune />
                    </ListItemIcon>
                    <ListItemText>
                        JellyfinMod Settings
                    </ListItemText>
                </MenuItem>
            )}
            {isRatingsVisible && (
                <MenuItem
                    component={Link}
                    to='/catalog/preferences'
                    onClick={onMenuClose}
                >
                    <ListItemIcon icon='star'>
                        <StarHalf />
                    </ListItemIcon>
                    <ListItemText>
                        Ratings Display
                    </ListItemText>
                </MenuItem>
            )}

            {(appHost.supports(AppFeature.DownloadManagement) || appHost.supports(AppFeature.ClientSettings)) && (
                <Divider />
            )}

            {appHost.supports(AppFeature.DownloadManagement) && (
                <MenuItem
                    onClick={onDownloadManagerClick}
                >
                    <ListItemIcon icon='arrow'>
                        <Download />
                    </ListItemIcon>
                    <ListItemText>
                        {globalize.translate('DownloadManager')}
                    </ListItemText>
                </MenuItem>
            )}

            {appHost.supports(AppFeature.ClientSettings) && (
                <MenuItem
                    onClick={onClientSettingsClick}
                >
                    <ListItemIcon icon='ctrl'>
                        <AppSettingsAlt />
                    </ListItemIcon>
                    <ListItemText>
                        {globalize.translate('ClientSettings')}
                    </ListItemText>
                </MenuItem>
            )}

            {/* ADMIN LINKS */}
            {user?.Policy?.IsAdministrator && ([
                <Divider key='admin-links-divider' />,
                <MenuItem
                    key='admin-dashboard-link'
                    component={Link}
                    to='/dashboard'
                    onClick={onMenuClose}
                >

                    <ListItemIcon icon='dash'>
                        <DashboardIcon />
                    </ListItemIcon>
                    <ListItemText primary={globalize.translate('TabDashboard')} />
                </MenuItem>,
                <MenuItem
                    key='admin-metadata-link'
                    component={Link}
                    to='/metadata'
                    onClick={onMenuClose}
                >
                    <ListItemIcon icon='edit'>
                        <Edit />
                    </ListItemIcon>
                    <ListItemText primary={globalize.translate('MetadataManager')} />
                </MenuItem>
            ])}

            <Divider />
            {isQuickConnectEnabled && (
                <MenuItem
                    component={Link}
                    to='/quickconnect'
                    onClick={onMenuClose}
                >
                    <ListItemIcon icon='qc'>
                        <PhonelinkLock />
                    </ListItemIcon>
                    <ListItemText>
                        {globalize.translate('QuickConnect')}
                    </ListItemText>
                </MenuItem>
            )}

            {appHost.supports(AppFeature.MultiServer) && (
                <MenuItem
                    onClick={onSelectServerClick}
                >
                    <ListItemIcon icon='display'>
                        <Storage />
                    </ListItemIcon>
                    <ListItemText>
                        {globalize.translate('SelectServer')}
                    </ListItemText>
                </MenuItem>
            )}

            <MenuItem
                onClick={onLogoutClick}
            >
                <ListItemIcon icon='out'>
                    <Logout />
                </ListItemIcon>
                <ListItemText>
                    {globalize.translate('ButtonSignOut')}
                </ListItemText>
            </MenuItem>

            {appHost.supports(AppFeature.ExitMenu) && ([
                <Divider key='exit-menu-divider' />,
                <MenuItem
                    key='exit-menu-button'
                    onClick={onExitAppClick}
                >
                    <ListItemIcon icon='close'>
                        <Close />
                    </ListItemIcon>
                    <ListItemText>
                        {globalize.translate('ButtonExitApp')}
                    </ListItemText>
                </MenuItem>
            ])}
        </Menu>
    );
};

export default AppUserMenu;
