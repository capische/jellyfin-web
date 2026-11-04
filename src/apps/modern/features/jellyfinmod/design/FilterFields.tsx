import React, { createContext, useContext, type FC } from 'react';
import MuiCheckbox, { type CheckboxProps } from '@mui/material/Checkbox';
import MuiFormGroup, { type FormGroupProps } from '@mui/material/FormGroup';
import MuiFormControlLabel, { type FormControlLabelProps } from '@mui/material/FormControlLabel';
import { Icon } from './Icon';

export const NativeFields = createContext(false);
export const Checkbox: FC<CheckboxProps & { isSwitch?: boolean }> = ({ isSwitch, ...props }) => {
    const native = useContext(NativeFields);
    if (!native) return <MuiCheckbox {...props} />;
    return <span className={`${isSwitch ? 'sw' : 'cb'}${props.checked ? ' on' : ''}`}><input type='checkbox' role={isSwitch ? 'switch' : undefined} name={props.name} checked={props.checked} value={props.value as string}
        disabled={props.disabled} onChange={event => {
            // Existing MUI handlers cancel their synthetic change. A native input must keep its click default.
            const nativeChange = Object.create(event) as React.ChangeEvent<HTMLInputElement>;
            nativeChange.preventDefault = () => undefined;
            props.onChange?.(nativeChange, event.target.checked);
        }} />{isSwitch ? <i /> : props.checked && <Icon name='check' />}</span>;
};
export const FormGroup: FC<FormGroupProps> = props => {
    const native = useContext(NativeFields);
    if (native) return <React.Fragment key='fields'>{props.children}</React.Fragment>;
    return <MuiFormGroup {...props} />;
};
export const FormControlLabel: FC<FormControlLabelProps & { isSwitch?: boolean }> = ({ isSwitch, ...props }) => {
    const native = useContext(NativeFields);
    return native ? <label className='mi cbrow' onFocus={event => event.currentTarget.classList.add('foc')}
        onBlur={event => event.currentTarget.classList.remove('foc')}>{isSwitch ? <><span className='tx0'>{props.label}</span><span style={{ marginLeft: 'auto' }}>{props.control}</span></> :
            <>{props.control}<span className='tx0'>{props.label}</span></>}</label> : <MuiFormControlLabel {...props} />;
};
