import Search from '@mui/icons-material/Search';
import React, { useEffect, useLayoutEffect, useRef, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import layoutManager from 'components/layoutManager';
import focusManager from 'components/focusManager';
import globalize from 'lib/globalize';
import { getKeyName } from 'scripts/keyboardNavigation';

import { isBackKey } from './dpadModals';

/** One URL-backed field. Navigating on the first character keeps the same mounted input and its caret. */
const ChromeSearch: FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const input = useRef<HTMLInputElement>(null);
    const keyboardVisible = useRef(false);
    const isSearch = location.pathname === '/search';
    const query = isSearch ? params.get('query') || '' : '';
    const [value, setValue] = useState(query);
    const [focused, setFocused] = useState(false);

    useEffect(() => setValue(query), [query, isSearch]);
    useEffect(() => {
        if (!layoutManager.tv) return;
        const keyboardState = (event: Event) => {
            keyboardVisible.current = !!(event as CustomEvent<{ visibility: boolean }>).detail?.visibility;
        };
        window.addEventListener('keyboardStateChange', keyboardState);
        return () => window.removeEventListener('keyboardStateChange', keyboardState);
    }, []);
    useEffect(() => {
        if (isSearch) input.current?.focus();
    }, [isSearch]);

    const openSearch = (nextValue: string) => {
        const next = new URLSearchParams();
        for (const key of ['parentId', 'topParentId', 'collectionType']) {
            const current = params.get(key);
            if (current) next.set(key === 'topParentId' ? 'parentId' : key, current);
        }
        if (nextValue) next.set('query', nextValue);
        navigate({ pathname: '/search', search: next.toString() }, { replace: isSearch });
    };

    return <label className={'jfmod-chromeSearch' + (focused ? ' jfmod-chromeSearch-focused' : '')}>
        <Search aria-hidden='true' />
        <input
            ref={input}
            id={isSearch ? 'searchTextInput' : 'jfmod-chromeSearchInput'}
            type='search'
            autoComplete='off'
            aria-label={globalize.translate('Search')}
            placeholder={globalize.translate('Search')}
            data-keyboard='true'
            value={value}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={event => {
                setValue(event.target.value);
                openSearch(event.target.value);
            }}
            onKeyDown={event => {
                const key = getKeyName(event.nativeEvent);
                if (layoutManager.tv && isBackKey(key) && keyboardVisible.current) {
                    event.preventDefault();
                    event.stopPropagation();
                    keyboardVisible.current = false;
                    input.current?.blur();
                } else if (key === 'Enter') {
                    // A real input keeps the trusted OK gesture, so webOS can open its native keyboard.
                    if (!isSearch) openSearch(value);
                    input.current?.focus();
                } else if (layoutManager.tv && event.key === 'ArrowDown') {
                    event.preventDefault();
                    event.stopPropagation();
                    const first = document.querySelector<HTMLElement>('#searchPage .card, #searchPage .jfmod-searchOpen')
                        || document.querySelector<HTMLElement>('#searchPage .alphaPicker button');
                    if (first) focusManager.focus(first);
                }
            }}
        />
    </label>;
};

/** The TV keeps its legacy header and remote navigation. Only its search stop is replaced. */
export const LegacyChromeSearch: FC = () => {
    const [target, setTarget] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        const host = document.createElement('div');
        host.className = 'jfmod-legacySearch';
        const attach = () => {
            const header = document.querySelector<HTMLElement>('.skinHeader .headerTop');
            if (header && host.parentElement !== header) header.insertBefore(host, header.querySelector('.headerRight'));
            if (host.isConnected) setTarget(host);
        };
        attach();
        const observer = new MutationObserver(attach);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            host.remove();
        };
    }, []);
    return target ? createPortal(<ChromeSearch />, target) : null;
};

export default ChromeSearch;
