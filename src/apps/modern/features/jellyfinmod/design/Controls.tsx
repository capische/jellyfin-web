import React, { type ButtonHTMLAttributes, type FC, type InputHTMLAttributes, type PropsWithChildren, useId, useState } from 'react';
import { Icon } from './Icon';
import { Menu } from './Menu';

export const Button: FC<ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'main' | 'destroy'; initialFocus?: boolean }> = ({ kind, className = '', disabled, onClick, initialFocus, ...props }) =>
    <button {...props} ref={node => {
        if (initialFocus) node?.setAttribute('autofocus', '');
    }} type={props.type || 'button'} className={`btn focusable ${kind || ''} ${disabled ? 'dis' : ''} ${className}`}
    aria-disabled={disabled || props['aria-disabled']} onClick={disabled || props['aria-disabled'] === true || props['aria-disabled'] === 'true' ? undefined : onClick} />;

/** DS.sw and DS.check: the visible switch and its whole-line control. */
export const Switch: FC<{ label: string;
    help?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean }> = ({ label, help, checked, onChange, disabled }) =>
    <div className='swl focusable' role='switch' aria-label={label} aria-checked={checked} aria-disabled={disabled} tabIndex={0}
        onFocus={event => event.currentTarget.closest('.layout-tv') && event.currentTarget.querySelector('.sw')?.classList.add('tvf')}
        onBlur={event => event.currentTarget.querySelector('.sw')?.classList.remove('tvf')}
        onClick={() => {
            if (!disabled) onChange(!checked);
        }} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
            }
        }}><span className='tx'><span>{label}</span>{help && <small>{help}</small>}</span>
        <span className={`sw${checked ? ' on' : ''}${disabled ? ' dis' : ''}`} aria-hidden='true'><i /></span></div>;

/** DS.field: the input replaces only the mockup's inert value span. */
export const Input: FC<InputHTMLAttributes<HTMLInputElement> & { label: string;
    help?: string;
    bad?: boolean; initialFocus?: boolean }> = ({ label, help, bad, id: givenId, required, initialFocus, ...props }) => {
    const generatedId = useId();
    const id = givenId || generatedId;
    return <><div className={`fld${bad ? ' bad' : ''}${props.disabled ? ' dis' : ''}`}
        onFocus={event => event.currentTarget.classList.add('foc')} onBlur={event => event.currentTarget.classList.remove('foc')}>
        <label className='lb' htmlFor={id}>{label}{required && <span aria-hidden='true'> *</span>}</label>
        <div className='box'><input {...props} ref={node => {
            if (initialFocus) node?.setAttribute('autofocus', '');
        }} id={id} required={required} aria-invalid={bad} className='v focusable' /></div>
    </div>{help && <div className='help'>{help}</div>}</>;
};

export const Select: FC<{ label: string;
    value: string;
    options: { value: string;
        label: string }[];
    onChange: (value: string) => void;
    busy?: boolean;
    id?: string }> = ({ label, value, options, onChange, busy, id }) => {
    const [open, setOpen] = useState(false);
    const close = React.useCallback(() => setOpen(false), []);
    return <div className={'fld' + (open ? ' open' : '')} onFocus={event => event.currentTarget.classList.add('foc')}
        onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('foc');
        }}>
        <span className='lb' id={id && `${id}-label`}>{label}</span>
        <div className='box focusable' id={id} role='combobox' aria-label={label} aria-expanded={open} aria-busy={busy}
            aria-controls={id && `${id}-list`} tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setOpen(!open);
                }
            }}><span className='v'>{options.find(option => option.value === value)?.label}</span><Icon name={open ? 'up' : 'down'} className='chev' /></div>
        {open && <Menu close={close} label={label} id={id && `${id}-list`} anchored>{options.map(option =>
            <div key={option.value} className={'mi focusable' + (option.value === value ? ' sel' : '')} role='option' aria-selected={option.value === value}
                tabIndex={0} ref={node => {
                    if (option.value === value) node?.setAttribute('autofocus', '');
                }} onClick={() => {
                    if (!busy) onChange(option.value);
                    close();
                }} onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.currentTarget.click();
                    }
                }}><span className='tx0'>{option.label}</span></div>)}</Menu>}
    </div>;
};

export const DialogContent: FC<PropsWithChildren<{ title?: string;
    narrow?: boolean;
    close?: () => void;
    className?: string }>> = ({ title, narrow, close, children, className = '' }) =>
    <div data-ds-dialog='' className={`dialog${narrow ? ' narrow' : ''} ${className}`} role='dialog' aria-modal='true' aria-label={title}>
        <div className='dlghead'><h3>{title}</h3>{close && <button type='button' className='rb focusable' aria-label='Close' title='Close' onClick={close}><Icon name='close' /></button>}</div>
        <div className='dlgbody'>{children}</div>
    </div>;
