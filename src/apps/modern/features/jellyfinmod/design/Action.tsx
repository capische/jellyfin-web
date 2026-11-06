import React, { type FC, type MouseEventHandler, type ReactElement } from 'react';
import { Icon, type IconName } from './Icon';

export interface ActionProps {
    onClick: MouseEventHandler<HTMLElement>;
    disabled?: boolean;
    title?: string;
    /** Played and Favourite: on or off, as the title page's controls say it. */
    pressed?: boolean;
}
export type ActionRenderer = (props: ActionProps) => ReactElement;

export const Action: FC<ActionProps & { icon: IconName; label?: string }> = ({ icon, label, title, onClick, disabled, pressed }) => <button
    type='button' className={`${label ? 'play' : 'dbtn'}${disabled ? ' off' : ' focusable'}`} data-tip={label ? undefined : title}
    aria-label={title} aria-pressed={pressed} disabled={disabled} onClick={onClick}
    onFocus={event => event.currentTarget.classList.add('focus')} onBlur={event => event.currentTarget.classList.remove('focus')}><Icon name={icon} />{label}</button>;
