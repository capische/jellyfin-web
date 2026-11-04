import React, { type FC, useCallback, useEffect, useState } from 'react';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { Button, Select } from './Controls';
import { Icon, type IconName } from './Icon';
import { Root } from './Root';

type Part =
    | { kind: 'heading'; key: string; text: string }
    | { kind: 'lead'; key: string; text: string }
    | { kind: 'select'; key: string; node: HTMLSelectElement; label: string; desc: string; value: string; disabled: boolean; options: { value: string; label: string }[] }
    | { kind: 'check'; key: string; node: HTMLInputElement; label: string; desc: string; checked: boolean; disabled: boolean }
    | { kind: 'input'; key: string; node: HTMLInputElement | HTMLTextAreaElement; label: string; desc: string; value: string; type: string; disabled: boolean }
    | { kind: 'item'; key: string; text: string; controls: Control[] }
    | { kind: 'button'; key: string; node: HTMLElement; label: string; main: boolean };
type Control = { key: string; node: HTMLElement; icon: IconName; title: string; check?: boolean; checked?: boolean };

const ICONS: [RegExp, IconName][] = [
    [/language|subtitle mode/i, 'globe'], [/date|locale/i, 'calendar'], [/display mode|layout/i, 'display'], [/theme/i, 'palette'], [/css/i, 'code'],
    [/backdrop|image|poster|cover/i, 'image'], [/animation|fade|fast/i, 'bolt'], [/screensaver|dark/i, 'moon'], [/password/i, 'lock'], [/user/i, 'person'],
    [/quick connect|code/i, 'qc'], [/audio|sound|music/i, 'audio'], [/subtitle|text|font|caption/i, 'subs'], [/quality|bitrate|resolution/i, 'hd'],
    [/speed|skip|seek/i, 'speed'], [/next|episode|repeat|play/i, 'play'], [/home|section|library|libraries/i, 'home'], [/remote|gamepad|key/i, 'ctrl']
];
const iconFor = (text: string): IconName => ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? 'gear';

const clean = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const shownIn = (node: Element, root: Element) => {
    // The page's direct children are hidden on purpose: this asks whether the controller shows the field.
    for (let at: Element | null = node; at && at.parentElement !== root; at = at.parentElement) {
        if (at.classList.contains('hide') || at.hasAttribute('hidden') || getComputedStyle(at).display === 'none') return false;
    }
    return true;
};
const labelOf = (node: HTMLElement) => clean((node as HTMLInputElement).labels?.[0])
    || clean(node.closest('.selectContainer, .inputContainer, .checkboxContainer')?.querySelector('label'))
    || clean(node.parentElement?.querySelector('label')) || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '';
const descOf = (node: HTMLElement) => clean(node.closest('.selectContainer, .inputContainer, .checkboxContainer')?.querySelector('.fieldDescription'));
const controlIcon = (node: Element): IconName => {
    const cls = node.className + ' ' + (node.querySelector('.material-icons')?.className ?? '');
    if (/up/i.test(cls)) return 'up';
    if (/down/i.test(cls)) return 'down';
    if (/delete|close|remove/i.test(cls)) return 'close';
    if (/edit/i.test(cls)) return 'edit';
    return 'more';
};

const keys = new WeakMap<Element, string>();
let sequence = 0;
const keyOf = (node: Element) => {
    if (!keys.has(node)) keys.set(node, String(++sequence));
    return keys.get(node)!;
};

/** Everything the page's controller shows, in order. Nothing is read twice or kept: the form stays the only state. */
const readParts = (view: HTMLElement): Part[] => {
    const parts: Part[] = [];
    const source = Array.from(view.children).filter(child => !child.classList.contains('jfmod-dsPrefsHost'));
    for (const top of source) {
        for (const node of Array.from(top.querySelectorAll<HTMLElement>('h1, h2, h3, legend, p, select, input, textarea, button, .listItem'))) {
            const inItem = node.parentElement?.closest('.listItem');
            if (inItem || !shownIn(node, view)) continue;
            const key = keyOf(node);
            if (node.matches('.listItem')) {
                parts.push({ kind: 'item', key, text: clean(node), controls: Array.from(node.querySelectorAll<HTMLElement>('button, input[type=checkbox]')).filter(control => shownIn(control, view)).map(control => (
                    { key: keyOf(control), node: control, icon: controlIcon(control), title: control.title || labelOf(control), check: control.matches('input'), checked: (control as HTMLInputElement).checked }
                )) });
            } else if (node.matches('h1, h2, h3, legend')) {
                if (clean(node) && !node.closest('.selectContainer, .inputContainer, .checkboxContainer')) parts.push({ kind: 'heading', key, text: clean(node) });
            } else if (node.matches('p')) {
                if (clean(node) && !node.closest('.selectContainer, .inputContainer, .checkboxContainer, .fieldDescription')) parts.push({ kind: 'lead', key, text: clean(node) });
            } else if (node instanceof HTMLSelectElement) {
                parts.push({ kind: 'select', key, node, label: labelOf(node), desc: descOf(node), value: node.value, disabled: node.disabled,
                    options: Array.from(node.options).map(option => ({ value: option.value, label: option.textContent ?? '' })) });
            } else if (node instanceof HTMLInputElement && node.type === 'checkbox') {
                parts.push({ kind: 'check', key, node, label: labelOf(node), desc: descOf(node), checked: node.checked, disabled: node.disabled });
            } else if (node instanceof HTMLInputElement && (node.type === 'file' || node.type === 'hidden')) {
                continue;
            } else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
                parts.push({ kind: 'input', key, node, label: labelOf(node), desc: descOf(node), value: node.value, type: node.type, disabled: node.disabled });
            } else if (clean(node)) {
                parts.push({ kind: 'button', key, node, label: clean(node), main: node.matches('[type=submit], .button-submit') });
            }
        }
    }
    return parts;
};

/** The value goes through the element's own setter, so a React-controlled input and a legacy one both see the event. */
const setValue = (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const owner = Object.getPrototypeOf(node) as object;
    Object.getOwnPropertyDescriptor(owner, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
};

const Row: FC<{ title: string; desc?: string; dd?: boolean; children: React.ReactNode }> = ({ title, desc, dd, children }) => <div className={'srow2' + (dd ? ' dd' : '')}>
    <span className='tilei'><Icon name={iconFor(title)} /></span>
    <span className='tx'><b>{title}</b>{desc && <small>{desc}</small>}</span>
    <span className='ctl'>{children}</span>
</div>;

const SwitchButton: FC<{ label: string; checked: boolean; disabled?: boolean; onClick: () => void }> = ({ label, checked, disabled, onClick }) => <span
    className={'sw focusable' + (checked ? ' on' : '') + (disabled ? ' dis' : '')} role='switch' tabIndex={0} aria-label={label} aria-checked={checked} aria-disabled={disabled}
    onClick={onClick} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
        }
    }}><i /></span>;

/** ds.js prefs-form, prefs-profile and prefs-quick, painted from the page's own hidden form (Preferences' controllers stay as they are). */
export const PrefsPage: FC<{ view: HTMLElement }> = ({ view }) => {
    const [parts, setParts] = useState<Part[]>(() => readParts(view));
    const refresh = useCallback(() => setParts(previous => {
        const next = readParts(view);
        const signature = (list: Part[]) => JSON.stringify(list, (name, value: unknown) => (name === 'node' ? undefined : value));
        return signature(previous) === signature(next) ? previous : next;
    }), [view]);
    useEffect(() => {
        // Controllers set `.value` after their async load with no event, so a mutation observer alone would miss it.
        const timer = window.setInterval(refresh, 500);
        return () => window.clearInterval(timer);
    }, [refresh]);
    useEffect(() => {
        // The TV starts on the first control, as the mockup's focus state does.
        if (!layoutManager.tv) return;
        const first = view.querySelector<HTMLElement>('.jfmod-dsPrefsHost .focusable');
        if (first) focusManager.focus(first);
    }, [view, parts.length > 0]);
    const isProfile = view.id === 'userProfilePage';
    const hasImage = isProfile && !view.querySelector('#btnDeleteImage')?.classList.contains('hide');
    const image = hasImage ? /url\(["']?(.*?)["']?\)/.exec((view.querySelector<HTMLElement>('#image')?.style.backgroundImage) ?? '')?.[1] : undefined;
    const headButtons = isProfile ? parts.filter(part => part.kind === 'button' && part.node.matches('#btnAddImage, #btnDeleteImage')) : [];
    const buttons = parts.filter(part => part.kind === 'button' && !headButtons.includes(part));
    const title = view.getAttribute('data-title') ?? '';
    const cards: { key: string; title: string; rows: Part[]; leads: string[] }[] = [];
    for (const part of parts) {
        if (part.kind === 'button') continue;
        if (part.kind === 'heading') {
            if (isProfile && part.text === clean(view.querySelector('.username'))) continue;
            cards.push({ key: part.key, title: part.text, rows: [], leads: [] });
            continue;
        }
        if (!cards.length) cards.push({ key: 'first', title: '', rows: [], leads: [] });
        const card = cards[cards.length - 1];
        if (part.kind === 'lead') card.leads.push(part.text);
        else card.rows.push(part);
    }
    return <Root><div className='pcol plain'>
        {isProfile ? <div className='mhead'><span className='avatar2'>{image ? <img src={image} alt='' /> : <Icon name='person' />}</span><span className='nm'>{clean(view.querySelector('.username'))}</span>
            <span style={{ flex: '1 1 auto' }} />{headButtons.map(part => part.kind === 'button' && <Button key={part.key} onClick={() => part.node.click()}>{part.label}</Button>)}</div> :
            title && <h1 className='ptitle'>{title}</h1>}
        {cards.map(card => <React.Fragment key={card.key}>
            {card.title && (card !== cards[0] || card.title !== title) && <h2 className='sect2'>{card.title}</h2>}
            {card.leads.map(lead => <p className='lead2' key={lead}>{lead}</p>)}
            {card.rows.length > 0 && <div className='scard'>{card.rows.map(part => {
                if (part.kind === 'select') {
                    return <Row key={part.key} title={part.label} desc={part.desc} dd><Select label='' value={part.value} options={part.options} busy={part.disabled} onChange={value => {
                        setValue(part.node, value);
                        refresh();
                    }} /></Row>;
                }
                if (part.kind === 'check') {
                    return <Row key={part.key} title={part.label} desc={part.desc}><SwitchButton label={part.label} checked={part.checked} disabled={part.disabled} onClick={() => {
                        if (part.disabled) return;
                        part.node.click();
                        refresh();
                    }} /></Row>;
                }
                if (part.kind === 'input') {
                    return <Row key={part.key} title={part.label} desc={part.desc} dd><div className='fld' onFocus={event => event.currentTarget.classList.add('foc')} onBlur={event => event.currentTarget.classList.remove('foc')}>
                        <div className='box'><input className='v focusable' aria-label={part.label} type={part.type} disabled={part.disabled} value={part.value} onChange={event => {
                            setValue(part.node, event.target.value);
                            refresh();
                        }} /></div></div></Row>;
                }
                if (part.kind === 'item') {
                    return <Row key={part.key} title={part.text}>{part.controls.map(control => (control.check ?
                        <SwitchButton key={control.key} label={part.text} checked={!!control.checked} onClick={() => {
                            control.node.click();
                            refresh();
                        }} /> :
                        <button type='button' key={control.key} className='ib focusable' title={control.title} aria-label={control.title} onClick={() => {
                            control.node.click();
                            refresh();
                        }}><Icon name={control.icon} /></button>))}</Row>;
                }
                return null;
            })}</div>}
        </React.Fragment>)}
        {buttons.length > 0 && <div className='btnrow'>{buttons.map(part => part.kind === 'button' && <Button key={part.key} kind={part.main ? 'main' : undefined} onClick={() => part.node.click()}>{part.label}</Button>)}</div>}
    </div></Root>;
};
