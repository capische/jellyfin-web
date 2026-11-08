import React, { type FC } from 'react';
import { icons } from './icons';

export type IconName = keyof typeof icons;
export const Icon: FC<{ name: IconName; className?: string }> = ({ name, className }) => {
    const stroke = ['history', 'client', 'x'].includes(name);
    let style: React.CSSProperties | undefined;
    if (stroke) style = { fill: 'none' };
    if (name === 'pin') style = { transform: 'rotate(45deg)' };
    return <svg data-ds-icon={name} className={className} viewBox='0 0 24 24' aria-hidden='true' style={style}
        stroke={stroke ? 'currentColor' : undefined} strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round'><path d={icons[name]} /></svg>;
};
const CLOUD_PATHS = <><path d='M8 13.5H6.6a3.6 3.6 0 0 1-.5-7.17A5 5 0 0 1 15.7 5.4a3.9 3.9 0 0 1 2 7.6 3.9 3.9 0 0 1-.7.5' />
    <path d='M12 9v12' /><path d='M8.5 17.5 12 21l3.5-3.5' /></>;

/**
 * The download cloud. With `add`, a filled plus badge sits on its top right, cut out of the cloud: the disc of a title that is
 * not in the library yet, which adds it and opens the release picker (the user, 2026-11-07: variant 1, "1").
 */
export const Cloud: FC<{ className?: string; add?: boolean }> = ({ className, add }) => {
    const id = 'jfmodcp' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
    if (!add) {
        return <svg className={className} viewBox='0 0 24 24' aria-hidden='true'><g fill='none' stroke='currentColor'
            strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round'>{CLOUD_PATHS}</g></svg>;
    }
    return <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
        <defs>
            <mask id={id + 'c'}><rect width='24' height='24' fill='#fff' /><circle cx='18.6' cy='5.4' r='5.5' fill='#000' /></mask>
            <mask id={id + 'p'}><rect width='24' height='24' fill='#fff' />
                <path d='M18.6 3.1v4.6M16.3 5.4h4.6' stroke='#000' strokeWidth='1.9' strokeLinecap='round' /></mask>
        </defs>
        <g fill='none' stroke='currentColor' strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round' mask={`url(#${id}c)`}>{CLOUD_PATHS}</g>
        <circle cx='18.6' cy='5.4' r='4.4' fill='currentColor' mask={`url(#${id}p)`} />
    </svg>;
};

export const Clock: FC = () => <svg viewBox='0 0 24 24' style={{ fill: 'none' }} stroke='currentColor' strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
    <circle cx='12' cy='12' r='8.5' /><path d='M12 7.5V12L15 14' />
</svg>;
