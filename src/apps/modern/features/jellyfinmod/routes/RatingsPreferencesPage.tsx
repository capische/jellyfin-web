import React, { type FC, useCallback, useEffect, useState } from 'react';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import Page from 'components/Page';
import { useApi } from 'hooks/useApi';

import { ALL_SOURCES, SOURCE_LONG, SOURCE_SHORT } from '../constants/ratings';
import { useRatingsPreferences } from '../hooks/useRatingsPreferences';
import type { RatingSource } from '../types/ratings';
import { raisedButtonClass } from '../utils/flatButton';
import '../components/ratings.scss';
import './ratingsPreferences.scss';

/** The route the user menu and the TV's Home link open (Phase 9, plan decision 8). */
export const RATINGS_PREFERENCES_ROUTE = '/catalog/preferences';

/**
 * Ratings display, for every signed-in user (P9.R6, R7): which sources the detail page shows and in which order, and the
 * one source a card may show (off by default). Plain buttons with upstream's button classes, so upstream's focus manager and
 * TV focus ring apply unchanged; every change is saved at once to the user's own display preferences.
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

    const chooseCard = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const value = event.currentTarget.dataset.jfmodCardSource as RatingSource | '';
        setCardSource(value || null);
        setStatus(value ? `Cards show ${SOURCE_SHORT[value]}. Saved.` : 'Cards show no rating. Saved.');
    }, [setCardSource]);

    let content: React.ReactNode;
    if (!user || !preferences.loaded) {
        content = <p className='jfmod-lead'>Loading…</p>;
    } else if (!preferences.enabled) {
        content = <p className='jfmod-lead'>Ratings are not available on this server: its JellyfinMod plugin does not offer them, or an administrator turned them off.</p>;
    } else {
        content = <>
            <p className='jfmod-lead'>
                Choose which ratings a title page shows, and in what order. Each value stays in its own scale. Values come through MDBList and
                TMDB, or from this server&apos;s own metadata, and can differ from what each site shows today.
            </p>
            <h2 className='jfmod-prefHeading'>On title pages</h2>
            <ol className='jfmod-prefList' aria-label='Rating sources'>
                {rows.map(({ source, on }) => {
                    const index = sources.indexOf(source);
                    return <li key={source} className='jfmod-prefRow'>
                        <button className={raisedButtonClass()} type='button' role='switch' aria-checked={on} data-jfmod-source-toggle={source}
                            onClick={toggle} title={SOURCE_LONG[source]}>
                            {on ? '☑' : '☐'} {SOURCE_LONG[source]}
                        </button>
                        {on && <>
                            <button className={raisedButtonClass()} type='button' data-jfmod-source={source} data-jfmod-move='up'
                                aria-disabled={index === 0} aria-label={`Move ${SOURCE_SHORT[source]} up`} onClick={move}>▲</button>
                            <button className={raisedButtonClass()} type='button' data-jfmod-source={source} data-jfmod-move='down'
                                aria-disabled={index === sources.length - 1} aria-label={`Move ${SOURCE_SHORT[source]} down`} onClick={move}>▼</button>
                        </>}
                    </li>;
                })}
            </ol>
            {preferences.ownChoice && <div className='jfmod-prefRow'>
                <button className={raisedButtonClass()} type='button' onClick={reset} data-jfmod-ratings-reset=''>Use the server’s default</button>
            </div>}
            <h2 className='jfmod-prefHeading'>On cards</h2>
            <p className='fieldDescription'>Show one rating in the card&apos;s text line in Movies and TV. Off by default.</p>
            <div className='jfmod-prefRow jfmod-prefCards' role='radiogroup' aria-label='Rating on cards'>
                <button className={raisedButtonClass()} type='button' role='radio' aria-checked={!cardSource} data-jfmod-card-source=''
                    onClick={chooseCard}>{cardSource ? '○' : '●'} Off</button>
                {sources.map(source => <button key={source} className={raisedButtonClass()} type='button' role='radio'
                    aria-checked={cardSource === source} data-jfmod-card-source={source} onClick={chooseCard}>
                    {cardSource === source ? '●' : '○'} {SOURCE_SHORT[source]}
                </button>)}
            </div>
            <p role='status' className='jfmod-prefStatus'>{status}</p>
        </>;
    }

    return (
        <Page id='jfmodRatingsPreferencesPage' title='Ratings display' className='mainAnimatedPage libraryPage noSecondaryNavPage'>
            <div className='padded-left padded-right padded-top padded-bottom-page jfmod-ratingsPreferences'>
                <h1>Ratings display</h1>
                {content}
            </div>
        </Page>
    );
};

export default RatingsPreferencesPage;
