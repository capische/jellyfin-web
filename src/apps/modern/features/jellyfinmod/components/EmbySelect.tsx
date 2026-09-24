import React, { type FC, useEffect, useLayoutEffect, useRef } from 'react';

import 'elements/emby-select/emby-select';

export interface EmbySelectOption {
    value: string;
    label: string;
}

interface EmbySelectProps {
    id: string;
    label: string;
    value: string;
    options: EmbySelectOption[];
    onChange: (value: string) => void;
}

/**
 * Upstream's `emby-select`, from React.
 *
 * `emby-select` is a customised built-in (`<select is="emby-select">`) registered through the v0 custom-elements
 * polyfill, and that polyfill's `document.createElement` only accepts a type-extension *string*: React creates an
 * `is` element with an options object, and the polyfill throws (`toLowerCase is not a function`), taking the whole
 * component down with it. Upstream's own React code therefore never renders one directly — `SelectElement` goes
 * through markup — and neither does this: the select is created from markup once, its options and value are kept in
 * step from props, and its changes are read with a native listener, because `emby-select` announces a choice made
 * in its TV action sheet with a non-bubbling `change` event that React's delegated `onChange` never sees.
 *
 * What that buys is upstream's behaviour unchanged: the label it draws, its focus styling, and on the TV the action
 * sheet a remote can drive, with Back to close it.
 */
const EmbySelect: FC<EmbySelectProps> = ({ id, label, value, options, onChange }) => {
    const host = useRef<HTMLDivElement>(null);
    const select = useRef<HTMLSelectElement | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useLayoutEffect(() => {
        const container = host.current;
        if (!container) return;
        container.innerHTML = '<select is="emby-select"></select>';
        const element = container.querySelector('select');
        if (!element) return;
        // Before the polyfill upgrades it, which is when `emby-select` reads its label.
        element.id = id;
        element.setAttribute('label', label);
        const onNativeChange = () => onChangeRef.current(element.value);
        element.addEventListener('change', onNativeChange);
        select.current = element;
        return () => {
            element.removeEventListener('change', onNativeChange);
            select.current = null;
            container.innerHTML = '';
        };
    // The select is created once per id; the label is upstream's, drawn when the element upgrades.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        const element = select.current;
        if (!element) return;
        const keepFocus = document.activeElement === element;
        element.innerHTML = '';
        for (const option of options) {
            const item = document.createElement('option');
            item.value = option.value;
            item.textContent = option.label;
            element.appendChild(item);
        }
        element.value = value;
        if (keepFocus && document.activeElement !== element) element.focus();
    }, [options, value]);

    return <div ref={host} className='selectContainer' />;
};

export default EmbySelect;
