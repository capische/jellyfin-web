import React, { type FC, useCallback, useEffect, useState } from 'react';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { useApi } from 'hooks/useApi';

import { ALL_SOURCES, SOURCE_LONG, SOURCE_SHORT } from '../constants/ratings';
import { useRatingsPreferences } from '../hooks/useRatingsPreferences';
import type { RatingSource } from '../types/ratings';
import { Root } from '../design/Root';
import { Icon } from '../design/Icon';
import { Select } from '../design/Controls';
import RatingIcon from '../components/RatingIcon';
import '../components/ratings.scss';

/** The route the user menu and the TV's Home link open (Phase 9, plan decision 8). */
export const RATINGS_PREFERENCES_ROUTE = '/catalog/preferences';

/**
 * Ratings display, for every signed-in user (P9.R6, R7): which sources the detail page shows and in which order, and the
 * one source a card may show (off by default). Source scard/srow2, switches and fields supply the markup; focusable controls
 * still participate in the app's TV navigation. Every change is saved at once to the user's own display preferences.
 */
const RatingsPreferencesPage: FC = () => {
    const { api, user } = useApi();
    const preferences = useRatingsPreferences(api);
    const { sources, setSources, setCardSource, cardSource } = preferences;
    const [status, setStatus] = useState('');
    // A row that moved is re-inserted in the DOM, which drops focus; the moved control takes it back.
    const [refocus, setRefocus] = useState<string | null>(null);
    const available = (preferences.available.length ? preferences.available : ALL_SOURCES)
        .filter(source => !sources.includes(source));
    const rows: { source: RatingSource; on: boolean }[] = [
        ...sources.map(source => ({ source, on: true })),
        ...available.map(source => ({ source, on: false }))
    ];

    useEffect(() => {
        if (!refocus) return;
        const target = document.querySelector<HTMLElement>(refocus);
        if (target) focusManager.focus(target);
        setRefocus(null);
    }, [refocus, sources]);

    useEffect(() => {
        // TV: start on the first switch, so the remote has somewhere to be (UX §13 rule 2).
        if (!layoutManager.tv || !preferences.enabled) return;
        const first = document.querySelector<HTMLElement>('#jfmodRatingsPreferencesPage [data-jfmod-source-toggle]');
        if (first) focusManager.focus(first);
    }, [preferences.enabled]);

    const toggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const source = event.currentTarget.dataset.jfmodSourceToggle as RatingSource;
        const next = sources.includes(source) ? sources.filter(value => value !== source) : [...sources, source];
        setSources(next);
        if (cardSource && !next.includes(cardSource)) setCardSource(null);
        setStatus(`${SOURCE_SHORT[source]} ${next.includes(source) ? 'shown' : 'hidden'}. Saved.`);
        setRefocus(`[data-jfmod-source-toggle="${source}"]`);
    }, [cardSource, setCardSource, setSources, sources]);

    const move = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (event.currentTarget.getAttribute('aria-disabled') === 'true') return;
        const source = event.currentTarget.dataset.jfmodSource as RatingSource;
        const direction = event.currentTarget.dataset.jfmodMove === 'up' ? -1 : 1;
        const index = sources.indexOf(source);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= sources.length) return;
        const next = [...sources];
        [next[index], next[target]] = [next[target], next[index]];
        setSources(next);
        setStatus(`${SOURCE_SHORT[source]} moved ${direction < 0 ? 'up' : 'down'}. Saved.`);
        setRefocus(`[data-jfmod-source="${source}"][data-jfmod-move="${event.currentTarget.dataset.jfmodMove}"]`);
    }, [setSources, sources]);

    const reset = useCallback(() => {
        setSources(null);
        if (cardSource && !preferences.defaultSources.includes(cardSource)) setCardSource(null);
        setStatus('The server’s default order applies again. Saved.');
        // The reset button leaves with the user's own order; focus goes to the first source switch, which stays, so a TV
        // remote is never left on a control that no longer exists (web review 2026-10-07, P2 4).
        setRefocus('#jfmodRatingsPreferencesPage [data-jfmod-source-toggle]');
    }, [cardSource, preferences.defaultSources, setCardSource, setSources]);

    const chooseCard = useCallback((value: string) => {
        setCardSource((value || null) as RatingSource | null);
        setStatus(value ? `Cards show ${SOURCE_SHORT[value as RatingSource]}. Saved.` : 'Cards show no rating. Saved.');
    }, [setCardSource]);

    let content: React.ReactNode;
    if (!user || !preferences.loaded) {
        content = <p className='help'>Loading…</p>;
    } else if (preferences.unanswered) {
        content = <p className='help' role='status' data-jfmod-ratings-unanswered=''>
            Ratings are unavailable for now: this server&apos;s JellyfinMod plugin has not answered. This page updates by itself when it does.
        </p>;
    } else if (!preferences.enabled) {
        content = <p className='help'>Ratings are not available on this server: its JellyfinMod plugin does not offer them, or an administrator turned them off.</p>;
    } else {
        content = <>
            <p className='help'>
                Choose which ratings a title page shows, and in what order. Each value stays in its own scale. Values come through MDBList and
                TMDB, or from this server&apos;s own metadata, and can differ from what each site shows today.
            </p>
            <h2 className='sect2'>On title pages</h2>
            <div className='scard' aria-label='Rating sources'>
                {rows.map(({ source, on }) => {
                    const index = sources.indexOf(source);
                    return <div key={source} className='srow2'>
                        <span className='tilei plain'><RatingIcon rating={{ source, value: 100, scale: 'percent' }} /></span>
                        <span className='tx'><b>{SOURCE_LONG[source]}</b><small>{on ? 'Shown in the first metadata row.' : 'Not shown.'}</small></span>
                        <span className='ctl'>
                            {on && <>
                                <button className='rb focusable' type='button' data-jfmod-source={source} data-jfmod-move='up'
                                    aria-disabled={index === 0} aria-label={`Move ${SOURCE_SHORT[source]} up`} onClick={move}><Icon name='up' /></button>
                                <button className='rb focusable' type='button' data-jfmod-source={source} data-jfmod-move='down'
                                    aria-disabled={index === sources.length - 1} aria-label={`Move ${SOURCE_SHORT[source]} down`} onClick={move}><Icon name='down' /></button>
                            </>}
                            <button type='button' className={'sw focusable' + (on ? ' on' : '')} role='switch' aria-checked={on} data-jfmod-source-toggle={source}
                                onClick={toggle} title={SOURCE_LONG[source]} aria-label={SOURCE_LONG[source]}><i /></button>
                        </span>
                    </div>;
                })}
            </div>
            {preferences.ownChoice && <div className='btnrow'>
                <button className='btn focusable' type='button' onClick={reset} data-jfmod-ratings-reset=''>Use the server’s default</button>
            </div>}
            <h2 className='sect2'>On cards</h2>
            <div className='scard'><div className='srow2 dd'>
                <span className='tilei'><Icon name='star' /></span>
                <span className='tx'><b>Rating on cards</b><small>One rating in the card’s text line in Movies and TV.</small></span>
                <span className='ctl'><Select label='Rating on cards' value={cardSource ?? ''} options={[{ value: '', label: 'None' },
                    ...sources.map(source => ({ value: source, label: SOURCE_SHORT[source] }))]} onChange={chooseCard} /></span>
            </div></div>
            <p role='status' className='help' data-jfmod-ratings-status=''>{status}</p>
        </>;
    }

    return (
        <Page id='jfmodRatingsPreferencesPage' title='Ratings Display' className='mainAnimatedPage libraryPage noSecondaryNavPage'>
            <Root><div className='pcol plain'>
                <h1 className='ptitle'>Ratings Display</h1>
                {content}
            </div></Root>
        </Page>
    );
};

export default RatingsPreferencesPage;
