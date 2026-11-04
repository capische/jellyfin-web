import React, { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import MuiMenu, { type MenuProps } from '@mui/material/Menu';
import MuiMenuItem, { type MenuItemProps } from '@mui/material/MenuItem';
import MuiListItemIcon, { type ListItemIconProps } from '@mui/material/ListItemIcon';
import MuiListItemText, { type ListItemTextProps } from '@mui/material/ListItemText';
import MuiListSubheader, { type ListSubheaderProps } from '@mui/material/ListSubheader';
import MuiListItem, { type ListItemProps } from '@mui/material/ListItem';
import MuiDivider, { type DividerProps } from '@mui/material/Divider';
import { Link } from 'react-router-dom';
import { Root } from './Root';
import { Menu as PaperMenu } from './Menu';
import { Icon, type IconName } from './Icon';

/** Presentation seam for existing toolbar menu controllers. Their permissions and handlers stay upstream. */
export const DesignMenus = createContext(false);
const Popup: FC<MenuProps> = props => {
    const { onClose, open, anchorEl, children } = props;
    const host = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const close = useCallback(() => onClose?.({}, 'backdropClick'), [onClose]);
    useLayoutEffect(() => {
        if (!open) return;
        const anchor = typeof anchorEl === 'function' ? anchorEl() : anchorEl;
        const rect = anchor?.getBoundingClientRect();
        const menu = host.current?.querySelector('.pmenu');
        if (!rect || !menu) return;
        const box = menu.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(menu).fontSize);
        let top = rect.bottom + 0.382 * em;
        if (top + box.height > window.innerHeight - em) top = rect.top - box.height - 0.382 * em;
        setPosition({ top: Math.max(em, top), left: Math.max(em, Math.min(rect.right - box.width, window.innerWidth - box.width - em)) });
    }, [open, anchorEl, children]);
    if (!props.open) return null;
    const list = props.slotProps?.list as { subheader?: React.ReactNode } | undefined;
    return createPortal(<Root className='menuportal'><div ref={host} style={{ position: 'fixed', ...position }}>
        <PaperMenu id={props.id} close={close} label={props.id || 'Menu'}>{list?.subheader}{props.children}</PaperMenu>
    </div></Root>, document.body);
};

export const Menu: FC<MenuProps> = props => {
    const design = useContext(DesignMenus);
    return design ? <Popup {...props} /> : <MuiMenu {...props} />;
};

type RowProps = Omit<MenuItemProps, 'onClick'> & { to?: string; onClick?: React.MouseEventHandler<HTMLElement> };
export const MenuItem: FC<RowProps> = props => {
    const design = useContext(DesignMenus);
    if (!design) return <MuiMenuItem {...props} />;
    const className = 'mi focusable' + (props.selected ? ' sel' : '') + (props.disabled ? ' dim' : '');
    if (props.to) return <Link role='menuitem' className={className} to={props.to} onClick={props.onClick}>{props.children}</Link>;
    return <button className={className} role='menuitem' aria-disabled={props.disabled} onClick={props.disabled ? undefined : props.onClick}>{props.children}</button>;
};
export const ListItemIcon: FC<ListItemIconProps & { icon?: IconName }> = ({ icon = 'display', ...props }) => {
    const design = useContext(DesignMenus);
    return design ? <Icon name={icon} /> : <MuiListItemIcon {...props} />;
};
export const ListItemText: FC<ListItemTextProps> = props => {
    const design = useContext(DesignMenus);
    return design ? <span className='tx0'>{props.primary ?? props.children}{props.secondary && <small>{props.secondary}</small>}</span> : <MuiListItemText {...props} />;
};
export const ListSubheader: FC<ListSubheaderProps> = props => {
    const design = useContext(DesignMenus);
    return design ? <span className='cap0'>{props.children}</span> : <MuiListSubheader {...props} />;
};
export const Divider: FC<DividerProps> = props => {
    const design = useContext(DesignMenus);
    return design ? <div className='mhr' /> : <MuiDivider {...props} />;
};

export const ListItem: FC<ListItemProps> = props => {
    const design = useContext(DesignMenus);
    return design ? <React.Fragment key='row'>{props.children}</React.Fragment> : <MuiListItem {...props} />;
};
