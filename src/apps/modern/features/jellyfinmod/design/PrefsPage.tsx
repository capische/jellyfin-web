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
    let at: Element | null = node;
    while (at && !root.isSameNode(at.parentElement)) {
        if (at.classList.contains('hide') || at.hasAttribute('hidden') || getComputedStyle(at).display === 'none') return false;
        at = at.parentElement;
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

const CONTAINER = '.selectContainer, .inputContainer, .checkboxContainer';

const itemPart = (node: HTMLElement, view: HTMLElement): Part => ({ kind: 'item', key: keyOf(node), text: clean(node),
    controls: Array.from(node.querySelectorAll<HTMLElement>('button, input[type=checkbox]')).filter(control => shownIn(control, view)).map(control => (
        { key: keyOf(control), node: control, icon: controlIcon(control), title: control.title || labelOf(control), check: control.matches('input'), checked: (control as HTMLInputElement).checked }
    )) });

const textPart = (node: HTMLElement): Part | null => {
    if (!clean(node)) return null;
    if (node.matches('p')) return node.closest(CONTAINER + ', .fieldDescription') ? null : { kind: 'lead', key: keyOf(node), text: clean(node) };
    return node.closest(CONTAINER) ? null : { kind: 'heading', key: keyOf(node), text: clean(node) };
};

const fieldPart = (node: HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement): Part | null => {
    const base = { key: keyOf(node), label: labelOf(node), desc: descOf(node), disabled: node.disabled };
    if (node instanceof HTMLSelectElement) {
        return { ...base, kind: 'select', node, value: node.value, options: Array.from(node.options).map(option => ({ value: option.value, label: option.textContent ?? '' })) };
    }
    if (node.type === 'checkbox') return { ...base, kind: 'check', node: node as HTMLInputElement, checked: (node as HTMLInputElement).checked };
    if (node.type === 'file' || node.type === 'hidden') return null;
    return { ...base, kind: 'input', node, value: node.value, type: node.type };
};

const partOf = (node: HTMLElement, view: HTMLElement): Part | null => {
    if (node.parentElement?.closest('.listItem') || !shownIn(node, view)) return null;
    if (node.matches('.listItem')) return itemPart(node, view);
    if (node.matches('h1, h2, h3, legend, p')) return textPart(node);
    if (node.matches('select, input, textarea')) return fieldPart(node as HTMLSelectElement);
    return clean(node) ? { kind: 'button', key: keyOf(node), node, label: clean(node), main: node.matches('[type=submit], .button-submit') } : null;
};

/** Everything the page's controller shows, in order. Nothing is read twice or kept: the form stays the only state. */
const readParts = (view: HTMLElement): Part[] => Array.from(view.children)
    .filter(child => !child.classList.contains('jfmod-dsPrefsHost'))
    .flatMap(top => Array.from(top.querySelectorAll<HTMLElement>('h1, h2, h3, legend, p, select, input, textarea, button, .listItem')))
    .map(node => partOf(node, view))
    .filter((part): part is Part => !!part);

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

const FieldRow: FC<{ part: Part; refresh: () => void }> = ({ part, refresh }) => {
    const change = (node: Parameters<typeof setValue>[0], value: string) => {
        setValue(node, value);
        refresh();
    };
    const click = (node: HTMLElement) => {
        node.click();
        refresh();
    };
    if (part.kind === 'select') {
        return <Row title={part.label} desc={part.desc} dd><Select label='' value={part.value} options={part.options} busy={part.disabled} onChange={value => change(part.node, value)} /></Row>;
    }
    if (part.kind === 'check') {
        return <Row title={part.label} desc={part.desc}><SwitchButton label={part.label} checked={part.checked} disabled={part.disabled} onClick={() => {
            if (!part.disabled) click(part.node);
        }} /></Row>;
    }
    if (part.kind === 'input') {
        return <Row title={part.label} desc={part.desc} dd><div className='fld' onFocus={event => event.currentTarget.classList.add('foc')} onBlur={event => event.currentTarget.classList.remove('foc')}>
            <div className='box'><input className='v focusable' aria-label={part.label} type={part.type} disabled={part.disabled} value={part.value} onChange={event => change(part.node, event.target.value)} /></div></div></Row>;
    }
    if (part.kind === 'item') {
        return <Row title={part.text}>{part.controls.map(control => (control.check ?
            <SwitchButton key={control.key} label={part.text} checked={!!control.checked} onClick={() => click(control.node)} /> :
            <button type='button' key={control.key} className='ib focusable' title={control.title} aria-label={control.title} onClick={() => click(control.node)}><Icon name={control.icon} /></button>))}</Row>;
    }
    return null;
};

type Card = { key: string; title: string; rows: Part[]; leads: string[] };

const cardsOf = (parts: Part[], skipHeading: string): Card[] => {
    const cards: Card[] = [];
    for (const part of parts) {
        if (part.kind === 'heading' && part.text !== skipHeading) cards.push({ key: part.key, title: part.text, rows: [], leads: [] });
        if (part.kind === 'heading' || part.kind === 'button') continue;
        if (!cards.length) cards.push({ key: 'first', title: '', rows: [], leads: [] });
        const card = cards[cards.length - 1];
        if (part.kind === 'lead') card.leads.push(part.text);
        else card.rows.push(part);
    }
    return cards;
};

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
    const loaded = parts.length > 0;
    useEffect(() => {
        // The TV starts on the first control, as the mockup's focus state does.
        if (!layoutManager.tv || !loaded) return;
        const first = view.querySelector<HTMLElement>('.jfmod-dsPrefsHost .focusable');
        if (first) focusManager.focus(first);
    }, [view, loaded]);
    const isProfile = view.id === 'userProfilePage';
    const hasImage = isProfile && !view.querySelector('#btnDeleteImage')?.classList.contains('hide');
    const image = hasImage ? /url\(["']?(.*?)["']?\)/.exec((view.querySelector<HTMLElement>('#image')?.style.backgroundImage) ?? '')?.[1] : undefined;
    const buttons = parts.filter((part): part is Extract<Part, { kind: 'button' }> => part.kind === 'button');
    const headButtons = isProfile ? buttons.filter(part => part.node.matches('#btnAddImage, #btnDeleteImage')) : [];
    const title = view.getAttribute('data-title') ?? '';
    const name = clean(view.querySelector('.username'));
    const cards = cardsOf(parts, isProfile ? name : '');
    return <Root><div className='pcol plain'>
        {isProfile ? <div className='mhead'><span className='avatar2'>{image ? <img src={image} alt='' /> : <Icon name='person' />}</span><span className='nm'>{name}</span>
            <span style={{ flex: '1 1 auto' }} />{headButtons.map(part => <Button key={part.key} onClick={() => part.node.click()}>{part.label}</Button>)}</div> :
            title && <h1 className='ptitle'>{title}</h1>}
        {cards.map(card => <React.Fragment key={card.key}>
            {card.title && (card !== cards[0] || card.title !== title) && <h2 className='sect2'>{card.title}</h2>}
            {card.leads.map(lead => <p className='lead2' key={lead}>{lead}</p>)}
            {card.rows.length > 0 && <div className='scard'>{card.rows.map(part => <FieldRow key={part.key} part={part} refresh={refresh} />)}</div>}
        </React.Fragment>)}
        {buttons.length > headButtons.length && <div className='btnrow'>{buttons.filter(part => !headButtons.includes(part)).map(part => <Button key={part.key} kind={part.main ? 'main' : undefined} onClick={() => part.node.click()}>{part.label}</Button>)}</div>}
    </div></Root>;
};
