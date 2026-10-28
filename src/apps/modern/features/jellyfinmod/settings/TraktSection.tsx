import LinkOffIcon from '@mui/icons-material/LinkOff';
import PersonIcon from '@mui/icons-material/Person';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { type Query, useQuery } from '@tanstack/react-query';
import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, useCallback, useState } from 'react';

import { flatButtonClass } from '../utils/flatButton';
import { type SectionProps, summariseTrakt, type TraktExport, type TraktExportRun, type TraktExportUser, traktWhen } from './settingsSections';
import { problemText, request, requestServer } from './settingsApi';
import { IconAction, type NoticeState, ScrollList, SectionFrame, StatePill, useConfirm } from './settingsWidgets';

/** How often an open Settings › Trakt or the Home notice reads the export's state again. */
export const TRAKT_POLL_MS = 60000;

/** The query both surfaces share. */
export const traktExportKey = (api: Api) => ['JellyfinMod', api.basePath, 'TraktExport'];

/** The stock Trakt plugin's own page in the Dashboard, where an account is authorized again. */
export const TRAKT_PLUGIN_PAGE = '#/configurationpage?name=trakt';

/** Why JellyfinMod will not start the export, in a sentence (`TraktExportRefusal` on the server). */
const refusalSentence = (trakt: TraktExport) => {
    switch (trakt.refusal) {
        case 'not_installed': return 'The Trakt plugin is not installed, so there is nothing to send. Install it from the Dashboard’s plugin catalog to use Trakt.';
        case 'old_plugin': return `This server runs Trakt plugin ${trakt.version ?? 'an older version'}. Its export can count a play twice, so JellyfinMod does not run it: update the Trakt plugin to ${trakt.minimumVersion.split('.')[0]} or later (it needs Jellyfin 12.1 or later).`;
        case 'no_users': return trakt.users.some(user => user.state === 'reconnect') ?
            'No account can receive watches until its Trakt sign-in is renewed: reconnect Trakt first.' :
            'No Jellyfin user is linked to Trakt. Link one on the Trakt plugin’s page in the Dashboard.';
        case 'unwatched_history': return 'Post unwatched history is on in the Trakt plugin, so its export would remove Trakt plays of episodes that are unwatched here. JellyfinMod does not run it while that is on.';
        case 'unknown': return 'The Trakt plugin’s settings could not be read, so JellyfinMod does not run its export.';
        default: return null;
    }
};

/** `10 minutes`, `1 minute`: the quiet period after an episode ends. */
const quietWords = (minutes: number) => `${minutes} minute${minutes === 1 ? '' : 's'}`;

/** The last export, or the last try, as the row's title. */
const lastRunLine = (trakt: TraktExport) => {
    const reconnect = trakt.users.filter(user => user.state === 'reconnect').map(user => user.name);
    if (trakt.running) return 'Exporting to Trakt now';
    const last = trakt.lastRun;
    if (!last) return 'No export has run yet';
    if (last.status === 'Completed' && trakt.lastRunConfirmed === false) {
        // The plugin completes its task even when Trakt refuses a write; JellyfinMod saw the error in its log.
        return `Last try: ${traktWhen(last.startedAt)} · not every watch reached Trakt`;
    }
    if (last.status !== 'Completed') {
        // A run that failed while an account's sign-in could not be renewed failed on that sign-in, not on the network.
        return `Last try: ${traktWhen(last.startedAt)} · ${reconnect.length ? 'failed: the Trakt sign-in could not be renewed' : 'Trakt could not be reached'}`;
    }
    const without = reconnect.length ? ', without ' + reconnect.join(', ') : '';
    return `Last export: ${traktWhen(last.startedAt)} · completed${without}`;
};

/** An account's state, beside its dot. */
const userState = (user: TraktExportUser) => {
    if (user.state !== 'reconnect') return 'Linked';
    return user.since ? `Sign-in expired ${traktWhen(user.since)}` : 'Sign-in expired';
};

/** What an account's row says under its state. */
const userLine = (user: TraktExportUser) => {
    if (user.state === 'reconnect') {
        return `Reconnect opens the Trakt plugin’s page in the Dashboard: choose ${user.name}, authorize, and enter the code on trakt.tv/activate.`;
    }
    const watches = user.postWatched ? 'Sends each watch as it ends.' : 'Post watched history is off in the Trakt plugin, so the export sends no watches for this account.';
    const collection = user.collections ? ' The export also updates this account’s Trakt collection (Synchronize collections is on in the Trakt plugin).' : '';
    return watches + collection;
};

/** What happens next, under that title. */
const nextLine = (trakt: TraktExport) => {
    const quiet = quietWords(trakt.quietMinutes);
    const reconnect = trakt.users.filter(user => user.state === 'reconnect');
    if (reconnect.length) {
        const once = trakt.autoExport ? '' : ' once the automatic export is on';
        return `Watches of ${reconnect.map(user => user.name).join(', ')} since ${traktWhen(reconnect[0].since) || 'the sign-in expired'} are sent by the first export after reconnecting; it starts by itself${once}.`;
    }
    if (trakt.running) return 'Each watched episode that Trakt does not have yet is sent with the time you watched it.';
    if (!trakt.autoExport) return 'Automatic sending is off. Sync Missing Watches Now sends what Trakt is missing at once.';
    if (trakt.lastRun && (trakt.lastRun.status !== 'Completed' || trakt.lastRunConfirmed === false)) {
        const next = trakt.nextAttemptAt ? ' Next try ' + traktWhen(trakt.nextAttemptAt) + ', then less often, at most every 6 hours.' : '';
        return `Episodes watched since the last completed export are checked and sent when Trakt answers.${next}`;
    }
    // The host says Completed; JellyfinMod has not yet looked in the log for a Trakt error during the run (within a minute).
    if (trakt.lastRun && trakt.lastRunConfirmed !== true) return 'Checking the last run…';
    return `Nothing is waiting. The next export runs ${quiet} after the next episode ends.`;
};

/** Why a run ran, as the Activity list says it (D73). */
const WHY_WORDS: [string, string][] = [
    ['watch', 'After a watch'], ['reconnect', 'After reconnecting'], ['daily', 'Daily check'], ['retry', 'Retry'], ['sync_now', 'Sync Now'],
    ['first', 'First export']
];
const whyWords = (why: string | null | undefined) => WHY_WORDS.find(([code]) => code === why)?.[1] ?? 'From the Dashboard';
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** `04:20 pm` today, otherwise with its day. */
const shortWhen = (iso: string | null | undefined) => traktWhen(iso).replace(/^today /, '');

/** What a clean run sent, from the stock plugin's count lines; null when its log had none. */
const sentWords = (run: TraktExportRun) => {
    // The server leaves a null out of its answer.
    const counts = [run.episodesWatched, run.moviesWatched, run.episodesCollected, run.moviesCollected];
    if (counts.every(count => count === null || count === undefined)) return null;
    const episodes = run.episodesWatched ?? 0;
    const movies = run.moviesWatched ?? 0;
    const collected = (run.episodesCollected ?? 0) + (run.moviesCollected ?? 0);
    if (!episodes && !movies && !collected) return 'Nothing to send: Trakt had every watch';
    const watched = [episodes ? plural(episodes, 'episode') : '', movies ? plural(movies, 'movie') : ''].filter(Boolean).join(' and ');
    return [watched ? `${watched} marked watched` : '', collected ? `${collected} added to the collection` : ''].filter(Boolean).join(', ');
};

/** One run of the Activity list: when · why, then its result and what it sent (D73). */
const RunRow: FC<{ run: TraktExportRun; newer?: TraktExportRun; next: string | null }> = ({ run, newer, next }) => {
    let pill: { kind: 'ok' | 'err' | 'warn'; words: string };
    let what: string | null;
    if (run.clean) {
        pill = { kind: 'ok', words: 'Completed' };
        what = sentWords(run);
    } else if (run.status === 'Completed' || run.status === 'Failed') {
        pill = { kind: 'err', words: 'Trakt error' };
        let retry = '';
        if (newer) retry = `; retried at ${shortWhen(newer.startedAt)}`;
        else if (next) retry = `; next try ${shortWhen(next)}`;
        what = (run.error ?? (run.status === 'Failed' ? 'Trakt could not be reached' : 'the Trakt plugin logged an error')) + retry;
    } else {
        pill = { kind: 'warn', words: 'Stopped' };
        what = null;
    }
    return (
        <div className='jfmod-brow' data-jfmod-trakt-run={run.startedAt}>
            <div className='jfmod-brow-main'>
                <strong>{traktWhen(run.startedAt)} · {whyWords(run.why)}</strong>
                <span className='jfmod-sub'>
                    <StatePill kind={pill.kind}>{pill.words}</StatePill>
                    {what && <span className='jfmod-runWhat'>· {what}</span>}
                </span>
            </div>
        </div>
    );
};

/** The account's Trakt avatar, or the person glyph on the grey disc when there is none (D70). */
const TraktAvatar: FC<{ url?: string | null }> = ({ url }) => {
    const [failed, setFailed] = useState<string | null>(null);
    const onError = useCallback(() => setFailed(url ?? null), [url]);
    if (url && failed !== url) return <img className='jfmod-traktAvatar' src={url} alt='' aria-hidden='true' referrerPolicy='no-referrer' onError={onError} />;
    return <span className='jfmod-traktAvatar jfmod-traktAvatar-none' aria-hidden='true'><PersonIcon /></span>;
};

/**
 * Settings › Trakt (Phase 13): missed watches to Trakt. JellyfinMod never talks to Trakt; it runs the stock Trakt plugin's
 * own export, which sends each watched episode Trakt does not have yet with the time it was watched. The section shows
 * that export's state, the automatic switch (off until turned on, Q3), Sync Missing Watches Now, and each linked account,
 * with Reconnect Trakt when the plugin's sign-in could not be renewed. Design: `reviews/phase13/mockups` in the workspace.
 */
export const TraktSection: FC<SectionProps> = props => {
    const { api, data, reload } = props;
    // The section reads the state again by itself while it is open (Codex review P2-5): every minute, every 5 seconds while
    // the plugin's export runs. The Home notice shares this query.
    const status = useQuery({
        queryKey: traktExportKey(api),
        queryFn: () => request<TraktExport>(api, 'GET', 'Trakt/Export'),
        enabled: !!data.trakt,
        initialData: data.trakt,
        retry: false,
        refetchInterval: (query: Query<TraktExport>) => (query.state.data?.running ? 5000 : TRAKT_POLL_MS)
    });
    const trakt = status.data ?? data.trakt;
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const [activityOpen, setActivityOpen] = useState(false);
    const toggleActivity = useCallback(() => setActivityOpen(open => !open), []);
    const [confirmDialog, ask] = useConfirm();
    const refresh = useCallback(() => Promise.all([status.refetch(), reload()]), [status, reload]);

    const save = useCallback((autoExport: boolean) => {
        // While a change is saved the switch stays focusable (aria-disabled, so a TV keeps its focus) and ignores presses.
        if (busy) return;
        setBusy(true);
        setNotice(null);
        request(api, 'PUT', 'Trakt/Export/Settings', { autoExport })
            .then(() => refresh())
            .catch(error => setNotice({ kind: 'err', text: problemText(error) }))
            .finally(() => setBusy(false));
    }, [api, busy, refresh]);
    const toggle = useCallback((event: React.ChangeEvent<HTMLInputElement>) => save(event.target.checked), [save]);
    // Browsers toggle a checkbox on Space only; a remote has no Space, so its OK (Enter) toggles the switch too.
    const toggleOnEnter = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'Enter' || !trakt) return;
        event.preventDefault();
        // A held OK repeats its keydown: only the first press changes the switch.
        if (event.repeat) return;
        save(!trakt.autoExport);
    }, [save, trakt]);

    // Disconnect (D48, D68): the Trakt plugin's own Deauthorize, which revokes the sign-in and removes the plugin's entry for
    // the user, so its settings start from the plugin's defaults when it is linked again.
    const disconnect = useCallback((user: TraktExportUser) => {
        const account = user.traktUsername ? `the Trakt account ${user.traktUsername}` : 'Trakt';
        ask({
            title: `Disconnect Trakt for ${user.name}?`,
            text: `Watches of ${user.name} stop going to ${account}: the Trakt plugin forgets this sign-in, and its settings for ${user.name} `
                + 'are reset to the plugin’s defaults. Nothing is removed from Trakt and nothing changes in Jellyfin. To connect again, '
                + `authorize ${user.name} on the Trakt plugin’s page in the Dashboard.`,
            action: 'Disconnect',
            onConfirm: () => {
                setBusy(true);
                setNotice(null);
                requestServer(api, 'POST', `/Trakt/Users/${user.userId}/Deauthorize`)
                    .then(() => {
                        setNotice({ kind: 'ok', text: `Trakt is disconnected for ${user.name}.` });
                        return refresh();
                    })
                    .catch(error => setNotice({ kind: 'err', text: problemText(error) }))
                    .finally(() => setBusy(false));
            }
        });
    }, [api, ask, refresh]);

    const refusal = trakt ? refusalSentence(trakt) : null;
    const syncNow = useCallback(() => {
        if (busy || refusal) return;
        setBusy(true);
        setNotice(null);
        request(api, 'POST', 'Trakt/Export')
            .then(() => {
                setNotice({ kind: 'ok', text: 'The Trakt plugin’s export has started.' });
                return refresh();
            })
            .catch(error => setNotice({ kind: 'err', text: problemText(error) }))
            .finally(() => setBusy(false));
    }, [api, busy, refusal, refresh]);

    if (!trakt) {
        return (
            <SectionFrame id='trakt' eyebrow={props.eyebrow} title='Trakt' state={summariseTrakt(trakt)}
                notice={{ kind: 'warn', text: 'Unavailable in this plugin build.' }} next={props.next} onGo={props.onGo}><span /></SectionFrame>
        );
    }

    const reconnect = trakt.users.filter(user => user.state === 'reconnect');
    let shown: NoticeState | null = notice;
    if (!shown && reconnect.length) {
        const since = reconnect[0].since ? ' on ' + traktWhen(reconnect[0].since).replace(/^today /, 'today at ') : '';
        shown = {
            kind: 'err',
            text: `Trakt gets nothing from ${reconnect.map(user => user.name).join(', ')}: the Trakt plugin’s sign-in expired${since} and could not be renewed. Watches are kept in Jellyfin and sent once you reconnect.`
        };
    }
    if (!shown && refusal) shown = { kind: 'warn', text: refusal };
    const blocked = !trakt.installed || trakt.refusal === 'old_plugin' || trakt.refusal === 'unknown';

    return (
        <SectionFrame id='trakt' eyebrow={props.eyebrow} title='Trakt' state={summariseTrakt(trakt)} notice={shown} next={props.next} onGo={props.onGo}>
            <p className='fieldDescription jfmod-lead'>
                The Trakt plugin sends each watch to Trakt as it ends. A watch that ends while Trakt cannot be reached would be lost, so
                JellyfinMod runs the plugin’s own export once Trakt answers again: it sends every watched episode Trakt does not have yet,
                with the time you watched it, and leaves the episodes Trakt already has alone, so no play is counted twice. JellyfinMod
                never signs in to Trakt itself.
            </p>
            {!blocked && (
                <>
                    <div className='jfmod-brow' data-jfmod-trakt='auto'>
                        <div className='jfmod-brow-main'>
                            <FormControlLabel
                                // The key handler sits on the switch's root, which the input's keydown bubbles to: MUI 6 keeps
                                // only onChange of the input slot's handlers.
                                control={<Switch checked={trakt.autoExport} onChange={toggle} onKeyDown={toggleOnEnter}
                                    slotProps={{ input: { 'aria-disabled': busy || undefined } }} />}
                                label='Send missed watches automatically' />
                            <div className='fieldDescription'>
                                {quietWords(trakt.quietMinutes)} after an episode ends, and again until it works. Off until you turn it on: the first
                                export also sends older watches that Trakt does not have.
                            </div>
                        </div>
                    </div>
                    <div className='jfmod-brow' data-jfmod-trakt='export'>
                        <div className='jfmod-brow-main'>
                            <strong data-jfmod-trakt-last=''>{lastRunLine(trakt)}</strong>
                            <span className='jfmod-sub' data-jfmod-trakt-next=''>{nextLine(trakt)}</span>
                            <div className='jfmod-inlineactions'>
                                <Button variant='contained' color='inherit' onClick={syncNow}
                                    aria-disabled={busy || !!refusal || trakt.running ? true : undefined}
                                    title={refusal ?? (trakt.running ? 'The export is running' : undefined)}>
                                    Sync Missing Watches Now
                                </Button>
                            </div>
                        </div>
                    </div>
                    <div className='jfmod-blist'>
                        {trakt.users.map(user => (
                            <div key={user.name} className={`jfmod-brow jfmod-traktUser${user.state === 'reconnect' ? ' jfmod-brow-err' : ''}`} data-jfmod-trakt-user={user.name}>
                                <TraktAvatar url={user.avatarUrl} />
                                <div className='jfmod-brow-main'>
                                    <strong>{user.name}{user.traktUsername && <span className='jfmod-traktHandle'> · {user.traktUsername} on Trakt</span>}</strong>
                                    <span className='jfmod-sub'><StatePill kind={user.state === 'reconnect' ? 'err' : 'ok'}>{userState(user)}</StatePill></span>
                                    <div className='fieldDescription'>{userLine(user)}</div>
                                    {user.state === 'reconnect' && (
                                        <div className='jfmod-inlineactions'>
                                            <Button variant='contained' href={TRAKT_PLUGIN_PAGE}>Reconnect Trakt</Button>
                                        </div>
                                    )}
                                </div>
                                <div className='jfmod-rowactions'>
                                    <IconAction label={`Disconnect Trakt for ${user.name}`} red disabled={busy} onClick={() => disconnect(user)}
                                        data={{ 'jfmod-trakt-disconnect': user.name }}><LinkOffIcon /></IconAction>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className='jfmod-group jfmod-traktActivity' data-jfmod-trakt='activity'>
                        <button type='button' className={flatButtonClass() + ' jfmod-activityToggle'} aria-expanded={activityOpen} onClick={toggleActivity}>
                            <span className='jfmod-activityChevron' aria-hidden='true'>{activityOpen ? '▾' : '▸'}</span>
                            <span className='jfmod-activityTitle'>Activity</span>
                            <span className='jfmod-activityHint'>
                                {activityOpen ? 'The last 20 exports, newest first' : 'The last 20 exports: when, why and what each sent'}
                            </span>
                        </button>
                        {activityOpen && (
                            <ScrollList label='Trakt exports, newest first'>
                                {trakt.running && (
                                    <div className='jfmod-brow' data-jfmod-trakt-run='running'>
                                        <div className='jfmod-brow-main'>
                                            <strong>now · {whyWords(trakt.runningWhy)}</strong>
                                            <span className='jfmod-sub'><StatePill kind='busy'>Running</StatePill></span>
                                        </div>
                                    </div>
                                )}
                                {(trakt.activity ?? []).map((run, index, all) => (
                                    <RunRow key={run.startedAt} run={run} newer={all[index - 1]} next={index === 0 ? trakt.nextAttemptAt : null} />
                                ))}
                                {!trakt.running && !trakt.activity?.length && (
                                    <div className='jfmod-brow'><div className='jfmod-brow-main'><span className='jfmod-sub'>No export has run yet.</span></div></div>
                                )}
                            </ScrollList>
                        )}
                    </div>
                </>
            )}
            {confirmDialog}
        </SectionFrame>
    );
};
