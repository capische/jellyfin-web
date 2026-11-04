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
export const Cloud: FC<{ className?: string }> = ({ className }) => <svg className={className} viewBox='0 0 24 24' aria-hidden='true'><g fill='none' stroke='currentColor'
    strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round'>
    <path d='M8 13.5H6.6a3.6 3.6 0 0 1-.5-7.17A5 5 0 0 1 15.7 5.4a3.9 3.9 0 0 1 2 7.6 3.9 3.9 0 0 1-.7.5' />
    <path d='M12 9v12' /><path d='M8.5 17.5 12 21l3.5-3.5' /></g></svg>;

export const Clock: FC = () => <svg viewBox='0 0 24 24' style={{ fill: 'none' }} stroke='currentColor' strokeWidth='2.3' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
    <circle cx='12' cy='12' r='8.5' /><path d='M12 7.5V12L15 14' />
</svg>;
