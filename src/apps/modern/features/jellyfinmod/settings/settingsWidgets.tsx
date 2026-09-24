import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import React, { type FC, type ReactNode, useCallback, useState } from 'react';

import type { SecretChange } from './settingsApi';

/** A dot with its words: state is never said by colour alone (UX §13). */
export type StateKind = 'ok' | 'warn' | 'err' | 'off' | 'busy';

export const StatePill: FC<{ kind: StateKind; children: ReactNode }> = ({ kind, children }) => (
    <span className={`jfmod-state jfmod-state-${kind}`}><i aria-hidden='true' /><span>{children}</span></span>
);

export interface NoticeState {
    kind: 'ok' | 'warn' | 'err';
    text: string;
    action?: { label: string; run: () => void };
}

export const Notice: FC<{ notice: NoticeState | null }> = ({ notice }) => {
    if (!notice) return null;
    return (
        <div className={`jfmod-notice jfmod-notice-${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
            <i aria-hidden='true' />
            <span className='jfmod-notice-text'>{notice.text}</span>
            {notice.action && (
                <span className='jfmod-notice-action'>
                    <Button size='small' onClick={notice.action.run}>{notice.action.label}</Button>
                </span>
            )}
        </div>
    );
};

interface SectionFrameProps {
    id: string;
    eyebrow: string;
    title: string;
    state?: { kind: StateKind; words: string };
    actions?: ReactNode;
    notice: NoticeState | null;
    children: ReactNode;
    onSave?: () => void;
    saving?: boolean;
    saveMeta?: string;
    next?: { id: string; title: string };
    onGo: (id: string) => void;
}

const NextButton: FC<{ next: { id: string; title: string }; onGo: (id: string) => void }> = ({ next, onGo }) => {
    const goNext = useCallback(() => onGo(next.id), [next.id, onGo]);
    return (
        <button type='button' className='jfmod-next' onClick={goNext}>
            Next: {next.title} →
        </button>
    );
};

/** One section of the checklist: eyebrow, heading, state, body, and the footer with Save and "Next". */
export const SectionFrame: FC<SectionFrameProps> = ({
    id, eyebrow, title, state, actions, notice, children, onSave, saving, saveMeta, next, onGo
}) => (
    <section className='jfmod-check-section' data-section={id} aria-labelledby={`jfmod-h-${id}`}>
        <header className='jfmod-check-sechead'>
            <div>
                <div className='jfmod-eyebrow'>{eyebrow}</div>
                <h2 id={`jfmod-h-${id}`} tabIndex={-1}>{title}</h2>
                {state && <StatePill kind={state.kind}>{state.words}</StatePill>}
            </div>
            {actions && <div className='jfmod-sec-actions'>{actions}</div>}
        </header>
        <div className='jfmod-check-secbody'>
            <Notice notice={notice} />
            {children}
        </div>
        {(onSave || next) && (
            <footer className='jfmod-check-secfoot'>
                {onSave && (
                    <Button variant='contained' onClick={onSave} disabled={saving} data-submit={id}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                )}
                {saveMeta && <span className='jfmod-savemeta' data-savemeta={id}>{saveMeta}</span>}
                {next && <NextButton next={next} onGo={onGo} />}
            </footer>
        )}
    </section>
);

interface SecretFieldProps {
    id: string;
    label: string;
    configured: boolean;
    change: SecretChange;
    onChange: (change: SecretChange) => void;
}

/**
 * A write-only secret (PHASE7 §5.1): "Configured" with Replace and Clear, a pending clear with Undo, and an
 * input only while a replacement is being typed. The page never receives, holds or logs a stored value.
 * Sections key it by their revision, so a save returns it to "Configured" instead of an empty "New …" input.
 */
export const SecretField: FC<SecretFieldProps> = ({ id, label, configured, change, onChange }) => {
    const [editing, setEditing] = useState(false);
    const undo = useCallback(() => onChange({ action: 'unchanged', value: null }), [onChange]);
    const type = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value ?
        { action: 'replace', value: event.target.value } : { action: 'unchanged', value: null }), [onChange]);
    const keep = useCallback(() => {
        setEditing(false);
        onChange({ action: 'unchanged', value: null });
    }, [onChange]);
    const replace = useCallback(() => setEditing(true), []);
    const clear = useCallback(() => onChange({ action: 'clear', value: null }), [onChange]);
    const replacing = editing || change.action === 'replace' || !configured;
    if (change.action === 'clear') {
        return (
            <div className='jfmod-secret jfmod-secret-pending'>
                <span className='jfmod-secret-label'>{label}</span>
                <div className='jfmod-secret-row'>
                    <span className='jfmod-secret-state'>Will be removed on save</span>
                    <Button size='small' onClick={undo}>Undo</Button>
                </div>
            </div>
        );
    }
    if (replacing) {
        return (
            <div className='jfmod-secret'>
                <TextField
                    id={id}
                    label={configured ? `New ${label.toLowerCase()}` : label}
                    type='password'
                    autoComplete='off'
                    fullWidth
                    margin='dense'
                    value={change.action === 'replace' ? change.value ?? '' : ''}
                    onChange={type}
                />
                {configured && (
                    <Button size='small' onClick={keep}>
                        Keep the saved one
                    </Button>
                )}
            </div>
        );
    }
    return (
        <div className='jfmod-secret'>
            <span className='jfmod-secret-label'>{label}</span>
            <div className='jfmod-secret-row'>
                <span className='jfmod-secret-state'><span className='jfmod-lock' aria-hidden='true' />Configured</span>
                <Button size='small' onClick={replace}>Replace</Button>
                <Button size='small' onClick={clear}>Clear</Button>
            </div>
        </div>
    );
};

/** A field of a flat settings form: the DTO key, how to edit it and what to say about it. */
export interface FieldSpec {
    key: string;
    label: string;
    type: 'bool' | 'int' | 'number' | 'text' | 'select' | 'list';
    options?: { value: string; label: string }[];
    help?: string;
    optional?: boolean;
}

export type Draft = Record<string, unknown>;

type FieldChange = (key: string, value: unknown) => void;

/** One control of a FieldForm, chosen by the field's type. */
const FieldControl: FC<{ field: FieldSpec; value: unknown; onChange: FieldChange }> = ({ field, value, onChange }) => {
    const { key, type, optional } = field;
    const toggle = useCallback((event: React.ChangeEvent<HTMLInputElement>) => onChange(key, event.target.checked), [key, onChange]);
    const choose = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(key, event.target.value || null), [key, onChange]);
    const edit = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const text = event.target.value;
        if (type === 'list') onChange(key, text.split(',').map(part => part.trim()).filter(Boolean));
        else if (type === 'int') onChange(key, text === '' && optional ? null : parseInt(text, 10));
        else if (type === 'number') onChange(key, text === '' && optional ? null : Number(text));
        else onChange(key, text);
    }, [key, type, optional, onChange]);
    if (type === 'bool') {
        return (
            <div>
                <FormControlLabel
                    control={<Switch checked={!!value} onChange={toggle} />}
                    label={field.label}
                />
                {field.help && <div className='fieldDescription jfmod-checkdesc'>{field.help}</div>}
            </div>
        );
    }
    if (type === 'select') {
        return (
            <TextField
                select fullWidth margin='dense' label={field.label} helperText={field.help}
                value={value ?? ''} onChange={choose}
            >
                {field.options?.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </TextField>
        );
    }
    let shown = '';
    if (Array.isArray(value)) shown = value.join(', ');
    else if (value !== null && value !== undefined) shown = String(value);
    return (
        <TextField
            fullWidth margin='dense' label={field.label} helperText={field.help}
            type={type === 'int' || type === 'number' ? 'number' : 'text'}
            value={shown}
            onChange={edit}
        />
    );
};

export const FieldForm: FC<{ fields: FieldSpec[]; draft: Draft; onChange: FieldChange }> = ({
    fields, draft, onChange
}) => (
    <div className='jfmod-group'>
        {fields.map(field => <FieldControl key={field.key} field={field} value={draft[field.key]} onChange={onChange} />)}
    </div>
);

/** Picks the request's keys out of a DTO, so a PATCH never carries a read-only field the server would refuse. */
export const pick = (source: Draft, keys: string[]) => Object.fromEntries(keys.map(key => [key, source[key] ?? null]));

interface PendingConfirm {
    title: string;
    text: string;
    action: string;
    onConfirm: () => void;
}

/**
 * A confirmation as an MUI dialog rather than `window.confirm` (REVIEW-2026-09-24 S8-R2): a native dialog is one a TV
 * remote may not be able to answer, and upstream never uses it. The dialog is an ordinary MUI modal, so on the TV
 * `shell/dpadModals` gives it arrows, Enter and Back, and Back returns focus to the button that opened it. Focus
 * starts on Cancel, so an Enter pressed by mistake removes nothing.
 */
export const useConfirm = (): [ReactNode, (pending: PendingConfirm) => void] => {
    const [pending, setPending] = useState<PendingConfirm | null>(null);
    const close = useCallback(() => setPending(null), []);
    const confirm = useCallback(() => {
        const current = pending;
        setPending(null);
        current?.onConfirm();
    }, [pending]);
    const element = pending && (
        <Dialog open onClose={close} maxWidth='xs' fullWidth className='jfmod-settingsDialog' data-jfmod-confirm=''>
            <DialogTitle>{pending.title}</DialogTitle>
            <DialogContent><p className='jfmod-lead'>{pending.text}</p></DialogContent>
            <DialogActions>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a destructive confirmation starts on Cancel (MUI's own idiom) */}
                <Button autoFocus onClick={close} data-jfmod-confirm='cancel'>Cancel</Button>
                <Button className='jfmod-danger-text' onClick={confirm} data-jfmod-confirm='confirm'>{pending.action}</Button>
            </DialogActions>
        </Dialog>
    );
    return [element, setPending];
};
