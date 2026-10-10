import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import React, { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
                    <Button variant='contained' color='inherit' onClick={notice.action.run}>{notice.action.label}</Button>
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
    /** A test of the saved secret, offered as the first icon in its box; its words and result sit under the box. */
    test?: { id: string; label: string; run: () => void; disabled?: boolean; help: ReactNode; result: NoticeState | null; state: TestState };
    /** A Save at the end of the input (user, 2026-10-09): it saves just this secret, and the caller then starts the field's test. */
    save?: { label: string; run: () => void; busy?: boolean };
}

/**
 * An icon-only action (user, 2026-10-07 and 2026-10-08): in a secret's box and in every settings list row. Grey, or red when
 * it destroys, as the labelled buttons are; round, at least 40 px. Its name is its aria-label and its tooltip, and names
 * the row it acts on ("Remove Prowlarr 1337x"). While busy or refused it is marked aria-disabled rather than disabled, as
 * the settings area refuses controls: the element and its tooltip stay, so the focus a remote put on it stays too (Codex
 * review 1, P2 1). `data` carries its data attributes (`data-secret-action`, `data-row-action`, …).
 */
export const IconAction: FC<{
    label: string; red?: boolean; disabled?: boolean; refused?: boolean; onClick: () => void; data: Record<string, string | undefined>; children: ReactNode;
    /** The tooltip when it says more than the name (a Test icon's last check), and extra classes. */
    tip?: string; className?: string;
}> = ({ label, red, disabled, refused, onClick, data, children, tip, className }) => {
    const attributes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => [`data-${key}`, value]));
    // `disabled` is busy (a request is out); `refused` is "not here" (Move Up on the first row): both keep the focus.
    const off = disabled || refused;
    return (
        <Tooltip title={tip ?? label}>
            <IconButton className={`jfmod-iconbtn jfmod-iconbtn-${red ? 'red' : 'grey'}${disabled ? ' jfmod-busy' : ''}${className ? ' ' + className : ''}`} aria-label={label}
                aria-disabled={off || undefined} onClick={off ? undefined : onClick} {...attributes}
            >
                {children}
            </IconButton>
        </Tooltip>
    );
};

/** What a Test icon shows: untested, running, passed or failed; when it last checked and why it failed go in its tooltip. */
export interface TestState {
    kind: 'idle' | 'testing' | 'ok' | 'fail';
    checkedAt?: string | null;
    reason?: string | null;
}

/** A date and time in the viewer's locale, as the Dashboard page's `when` writes them. */
const localeWhen = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const testTip = (label: string, test: TestState) => {
    const checked = test.checkedAt ? ` · last checked ${localeWhen(test.checkedAt)}` : '';
    const reason = test.reason ? `: ${test.reason}` : '';
    switch (test.kind) {
        case 'testing': return `${label} — testing…`;
        case 'fail': return `${label} — failed${reason}${checked}`;
        case 'ok': return `${label} — passed${checked}`;
        default: return `${label} — not tested yet`;
    }
};

/**
 * The Test icon's glyph (user, 2026-10-09, design C2 "Gauge"): signal arcs with a needle across them. It is the whole
 * indicator: the needle sweeps while the test runs, a pass colours the glyph green, a failure red with the needle dropped.
 * The classes on the button (`jfmod-testing`, `jfmod-test-ok`, `jfmod-test-fail`) drive it; the words are said by the live
 * status beside the icon, and the tooltip adds when it last checked or why it failed.
 */
const TestSignal: FC = () => (
    <svg className='jfmod-testsig' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.7' strokeLinecap='round' aria-hidden='true'>
        <path d='M8.46 16.46A5 5 0 0 1 15.54 16.46' />
        <path d='M5.64 13.64A9 9 0 0 1 18.36 13.64' />
        <path d='M2.81 10.81A13 13 0 0 1 21.19 10.81' />
        <circle cx='12' cy='19.2' r='1.7' fill='currentColor' stroke='none' />
        <g className='jfmod-testsig-needle'>
            <path className='jfmod-testsig-cut' d='M12 19.2L16.2 7.2' strokeWidth='5.4' />
            <path d='M12 19.2L16.2 7.2' />
        </g>
    </svg>
);

export const TestIcon: FC<{
    label: string; test: TestState; busy?: boolean; onClick: () => void; data: Record<string, string | undefined>;
}> = ({ label, test, busy, onClick, data }) => (
    <IconAction label={label} tip={testTip(label, test)} disabled={busy || test.kind === 'testing'} onClick={onClick} data={{ ...data, 'test-state': test.kind }}
        className={`jfmod-iconbtn-test${test.kind === 'testing' ? ' jfmod-testing' : ''}${test.kind === 'ok' ? ' jfmod-test-ok' : ''}${test.kind === 'fail' ? ' jfmod-test-fail' : ''}`}
    >
        <span className='jfmod-testglyph' aria-hidden='true'><TestSignal /></span>
    </IconAction>
);

const SecretIcon: FC<{ label: string; red?: boolean; onClick: () => void; action: string; children: ReactNode }> = ({
    label, red, onClick, action, children
}) => (
    <IconAction label={label} red={red} onClick={onClick} data={{ 'secret-action': action }}>{children}</IconAction>
);

/**
 * A write-only secret (PHASE7 §5.1): "Configured" with Replace and Clear, a pending clear with Undo, and an
 * input only while a replacement is being typed. The page never receives, holds or logs a stored value.
 * Sections key it by their revision, so a save returns it to "Configured" instead of an empty "New …" input.
 */
export const SecretField: FC<SecretFieldProps> = ({ id, label, configured, change, onChange, test, save }) => {
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
    const typedNow = change.action === 'replace' && !!change.value;
    // Enter in the input saves it, as the Save beside it does.
    const saveOnEnter = useCallback((event: React.KeyboardEvent) => {
        if (save && event.key === 'Enter' && typedNow && !save.busy) {
            event.preventDefault();
            save.run();
        }
    }, [save, typedNow]);
    // The box holds icon-only actions, Test (when the secret has one), Replace and Clear, in that order (user, 2026-10-07);
    // Undo, which takes back a pending clear, is an ordinary grey button the size of Save.
    const below = test && (
        <div className='jfmod-secret-below'>
            <div className='fieldDescription'>{test.help}</div>
            {test.result && <div data-secret-test-result=''><Notice notice={test.result} /></div>}
        </div>
    );
    if (change.action === 'clear') {
        return (
            <div className='jfmod-secret jfmod-secret-pending'>
                <span className='jfmod-secret-label'>{label}</span>
                <div className='jfmod-secret-row'>
                    <span className='jfmod-secret-state'>Will be removed on save</span>
                    <Button variant='contained' color='inherit' onClick={undo}>Undo</Button>
                </div>
                {below}
            </div>
        );
    }
    if (replacing) {
        const typed = typedNow;
        // A stored secret's edit field is the Configured box in another state: a placeholder, no floating label (its height and
        // text start are the box's, see settings.scss); a secret with nothing stored keeps its labelled field.
        const fieldNaming = configured ? { className: 'jfmod-secret-input', placeholder: 'New value', hiddenLabel: true } : { label };
        const accessibleName = configured ? { 'aria-label': `New ${label}` } : undefined;
        // One field: the buttons sit inside it, at its right end, as the Configured box holds its own (user, 2026-10-09).
        const buttons = (save || configured) && (
            <span className='jfmod-secret-inputrow'>
                {save && (
                    <IconAction label={save.label} refused={!typed} disabled={save.busy} onClick={save.run} data={{ 'secret-action': 'save' }}><SaveIcon /></IconAction>
                )}
                {configured && (
                    <IconAction label='Keep the Saved One' onClick={keep} data={{ 'secret-action': 'keep' }}><CloseIcon /></IconAction>
                )}
            </span>
        );
        return (
            <div className='jfmod-secret'>
                {/* The header stays while a replacement is typed, as in the Configured view (user, 2026-10-10); the input's own
                    label is then a short prompt, and its accessible name still says which secret it replaces. */}
                {configured && <span className='jfmod-secret-label'>{label}</span>}
                <TextField
                    id={id}
                    {...fieldNaming}
                    type='password'
                    autoComplete='off'
                    fullWidth
                    margin='dense'
                    value={change.action === 'replace' ? change.value ?? '' : ''}
                    onChange={type}
                    onKeyDown={saveOnEnter}
                    slotProps={{
                        input: { endAdornment: buttons || undefined },
                        htmlInput: accessibleName
                    }}
                />
                {below}
            </div>
        );
    }
    return (
        <div className='jfmod-secret'>
            <span className='jfmod-secret-label'>{label}</span>
            <div className='jfmod-secret-row'>
                <span className='jfmod-secret-state'><span className='jfmod-lock' aria-hidden='true' />Configured</span>
                {test && <span className='jfmod-teststatus' aria-live='polite'>{test.state.kind === 'testing' ? 'Testing…' : ''}</span>}
                {test && (
                    <TestIcon label={test.label} test={test.state} busy={test.disabled} onClick={test.run} data={{ 'secret-action': 'test', test: test.id }} />
                )}
                <SecretIcon label='Replace' onClick={replace} action='replace'><EditIcon /></SecretIcon>
                <SecretIcon label='Clear' red onClick={clear} action='clear'><DeleteIcon /></SecretIcon>
            </div>
            {below}
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

/**
 * MUI draws a select as a `div[role=combobox]`, which upstream's focusManager does not count as focusable: the TV's arrows
 * skipped it (whole-review chunk 4b, P2 3). Its trigger takes the `focusable` class the spatial navigation looks for;
 * Enter opens it, and `shell/dpadModals` drives the open menu.
 */
export const FOCUSABLE_SELECT = { select: { SelectDisplayProps: { className: 'focusable' } } };

const parseList = (text: string) => text.split(',').map(part => part.trim()).filter(Boolean);

/**
 * A comma-separated list keeps the text as typed while it is edited, so `2000,` keeps its comma (whole-review chunk 4b,
 * P2 2); the parsed list is what the draft holds. A change from outside (a reload) shows the new list.
 */
const ListField: FC<{ field: FieldSpec; value: unknown; onChange: FieldChange }> = ({ field, value, onChange }) => {
    const list = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value]);
    const [text, setText] = useState(() => list.join(', '));
    useEffect(() => {
        setText(current => (parseList(current).join(',') === list.join(',') ? current : list.join(', ')));
    }, [list]);
    const edit = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setText(event.target.value);
        onChange(field.key, parseList(event.target.value));
    }, [field.key, onChange]);
    const tidy = useCallback(() => setText(list.join(', ')), [list]);
    return <TextField fullWidth margin='dense' label={field.label} helperText={field.help} value={text} onChange={edit} onBlur={tidy} />;
};

/** One control of a FieldForm, chosen by the field's type. */
const FieldControl: FC<{ field: FieldSpec; value: unknown; onChange: FieldChange }> = ({ field, value, onChange }) => {
    const { key, type, optional } = field;
    const toggle = useCallback((event: React.ChangeEvent<HTMLInputElement>) => onChange(key, event.target.checked), [key, onChange]);
    const choose = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(key, event.target.value || null), [key, onChange]);
    const edit = useCallback((event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const text = event.target.value;
        if (type === 'int') onChange(key, text === '' && optional ? null : parseInt(text, 10));
        else if (type === 'number') onChange(key, text === '' && optional ? null : Number(text));
        else onChange(key, text);
    }, [key, type, optional, onChange]);
    if (type === 'bool') {
        return (
            <div className='jfmod-switchfield'>
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
                value={value ?? ''} onChange={choose} slotProps={FOCUSABLE_SELECT}
            >
                {field.options?.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </TextField>
        );
    }
    if (type === 'list') return <ListField field={field} value={value} onChange={onChange} />;
    let shown = '';
    if (value !== null && value !== undefined) shown = String(value);
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
    // The confirmation runs once: a second press that lands before the dialog closes finds it already taken (Codex delta
    // review 8, P2 4, repeated activation).
    const pendingNow = useRef<PendingConfirm | null>(null);
    pendingNow.current = pending;
    const close = useCallback(() => {
        pendingNow.current = null;
        setPending(null);
    }, []);
    const confirm = useCallback(() => {
        const current = pendingNow.current;
        pendingNow.current = null;
        setPending(null);
        current?.onConfirm();
    }, []);
    const element = pending && (
        <Dialog open onClose={close} maxWidth='xs' fullWidth className='jfmod-settingsDialog' data-jfmod-confirm=''>
            <DialogTitle>{pending.title}</DialogTitle>
            <DialogContent><p className='jfmod-lead'>{pending.text}</p></DialogContent>
            <DialogActions>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a destructive confirmation starts on Cancel (MUI's own idiom) */}
                <Button variant='contained' color='inherit' autoFocus onClick={close} data-jfmod-confirm='cancel'>Cancel</Button>
                <Button variant='contained' color='error' onClick={confirm} data-jfmod-confirm='confirm'>{pending.action}</Button>
            </DialogActions>
        </Dialog>
    );
    return [element, setPending];
};

/**
 * A fixed-height scrolling list (user, 2026-10-09): a tab stop with a visible ring, so the keyboard and the TV's remote can
 * reach it, and the arrows scroll it while it has room to go and then let go, so the focus moves on (a remote has no wheel).
 * Its class `focusable` is what upstream's spatial navigation looks for.
 */
export const ScrollList: FC<{ label: string; children: ReactNode }> = ({ label, children }) => {
    const area = useRef<HTMLDivElement>(null);
    const scroll = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        const node = area.current;
        const down = event.key === 'ArrowDown';
        // Only from the region itself: an action inside a row keeps the arrows for moving between rows.
        if (!node || event.target !== node || (!down && event.key !== 'ArrowUp')) return;
        const room = down ? node.scrollHeight - node.clientHeight - node.scrollTop > 1 : node.scrollTop > 0;
        if (!room) return;
        event.preventDefault();
        event.stopPropagation();
        node.scrollTop += (down ? 1 : -1) * parseFloat(getComputedStyle(node).fontSize) * 3;
    }, []);
    return (
        // A region that scrolls has to be reachable without a pointer (WCAG 2.1.1), hence the tab stop on a non-interactive role.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
        <div ref={area} className='jfmod-blist jfmod-scrolllist focusable' role='region' aria-label={label} tabIndex={0} onKeyDown={scroll}>
            {children}
        </div>
    );
};

/** When something happened, small and dim, in the viewer's locale. */
export const WhenLine: FC<{ words: string; at?: string | null }> = ({ words, at }) => (
    at ? <time className='jfmod-when' dateTime={at}>{words} {localeWhen(at)}</time> : null
);
