import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import PersonIcon from '@mui/icons-material/Person';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { type Query, useQuery } from '@tanstack/react-query';
import type { Api } from '@jellyfin/sdk/lib/api';
import React, { type FC, useCallback, useState } from 'react';

import { flatButtonClass } from '../utils/flatButton';
import { type SectionProps, summariseTrakt, type TraktActivity, type TraktExport, type TraktExportUser, traktWhen } from './settingsSections';
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

/** What the import switch does, or why the import is not run (D109, D111). */
const importLine = (trakt: TraktExport) => {
    if (trakt.importRefusal === 'unwatched_import') {
        return 'Skip unwatched import is off in the Trakt plugin, so its import would mark unwatched here everything Trakt has no play of. '
            + 'JellyfinMod does not run it while that is off.';
    }
    return 'Watches and playback positions from your other apps come into Jellyfin through the Trakt plugin’s own import: before the '
        + 'export on Sync Now and after reconnecting, and once a day while sending is automatic. Nothing is marked unwatched here.';
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
    if (!trakt.users.length) return 'Nothing is sent until a Trakt account is connected.';
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
    // An export already due names its time, so it agrees with the waiting titles in Activity (D130).
    if (trakt.nextExportAt) return `The next export runs at ${clock(trakt.nextExportAt)}, ${quiet} after the last episode ended.`;
    return `Nothing is waiting. The next export runs ${quiet} after the next episode ends.`;
};

/** `10:41 PM`: a row's time, in the viewer's clock. */
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

/** `Today`, `Yesterday` or `Mon 27 Oct`: the day heading a row sits under (D125). */
const dayOf = (iso: string) => {
    const day = new Date(iso);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Why a title still waits for Trakt (D126): its account's sign-in, Trakt's last answer, the automatic switch, or the due export. */
const waitingWords = (row: TraktActivity, trakt: TraktExport) => {
    if (trakt.users.find(user => user.name === row.user)?.state === 'reconnect') return 'waiting: reconnect Trakt to send it';
    if (trakt.lastError && trakt.nextAttemptAt && trakt.autoExport) {
        // `Trakt answered 500 Internal Server Error` reads `Trakt answered 500` in the row.
        const answer = /^Trakt answered \d+/.exec(trakt.lastError)?.[0] ?? trakt.lastError;
        return `waiting: ${answer}, next try ${clock(trakt.nextAttemptAt)}`;
    }
    if (!trakt.autoExport) return 'not checked yet (automatic sending is off)';
    if (trakt.nextExportAt) return `waiting: the export runs at ${clock(trakt.nextExportAt)}`;
    return 'waiting: the next export sends it';
};

/** A row's action and its dot: blue done, amber waiting or in progress, red failed (D126, D130, D134). */
const actionOf = (row: TraktActivity, trakt: TraktExport): { kind: 'ok' | 'warn' | 'err'; words: string } => {
    const count = row.detail ?? 0;
    switch (row.state) {
        case 'playing': return { kind: 'warn', words: 'watching now on Trakt (reported live by the Trakt plugin)' };
        case 'stopped': return { kind: 'ok', words: `stopped at ${count} % (reported live by the Trakt plugin)` };
        case 'waiting': return { kind: 'warn', words: waitingWords(row, trakt) };
        case 'sent': return { kind: 'ok', words: 'marked watched on Trakt' };
        case 'failed': return { kind: 'err', words: `failed: Trakt does not know this ${row.kind === 'movie' ? 'movie' : 'episode'}` };
        case 'imported': return { kind: 'ok', words: 'marked watched in Jellyfin (from Trakt)' };
        case 'position': return { kind: 'ok', words: `playback position from Trakt: ${count} min` };
        case 'collection': return { kind: 'ok', words: 'added to the Trakt collection' };
        case 'summary': return { kind: 'ok', words: row.direction === 'from' ? 'marked watched in Jellyfin (from Trakt)' : 'marked watched on Trakt (one export)' };
        default: return { kind: 'ok', words: row.state };
    }
};

/** What the row names: the title in bold and its episode, or for a count row the count (D126). */
const mediaOf = (row: TraktActivity) => {
    const count = row.detail ?? 0;
    if (row.state === 'collection') return <b>{plural(count, 'title')}</b>;
    if (row.state === 'summary') return <b>{row.direction === 'from' ? plural(count, 'title') : plural(count, 'episode')}</b>;
    return <><b>{row.title}</b>{row.code ? ` ${row.code}` : ''}</>;
};

/**
 * One title of Activity: the time in its own column, then "media · action" (D125, D130, D162), with the Jellyfin user before the
 * media when more than one account is linked.
 */
const ActivityRow: FC<{ row: TraktActivity; trakt: TraktExport; withUser: boolean }> = ({ row, trakt, withUser }) => {
    const action = actionOf(row, trakt);
    return (
        <div className='jfmod-brow jfmod-traktItem' data-jfmod-trakt-item={`${row.direction}:${row.state}:${row.title}${row.code ? ' ' + row.code : ''}`}>
            <div className='jfmod-brow-main'>
                <span className='jfmod-traktLine'>
                    <span className='jfmod-traktTime'>{clock(row.at)}</span>
                    <span className='jfmod-traktWhat'>
                        <span className='jfmod-traktMedia'>{withUser && `${row.user} · `}{mediaOf(row)}</span>
                        <span className='jfmod-traktSep'> · </span>
                        <StatePill kind={action.kind}>{action.words}</StatePill>
                    </span>
                </span>
            </div>
        </div>
    );
};

/** The rows in one group per day under its pinned day band (D159), newest first. */
const activityRows = (trakt: TraktExport) => {
    const rows = trakt.activity ?? [];
    if (!rows.length) {
        return [<div key='none' className='jfmod-brow'><div className='jfmod-brow-main'><span className='jfmod-sub'>Nothing was sent to Trakt or brought from it in the last 30 days.</span></div></div>];
    }
    const withUser = trakt.users.length > 1;
    const days: { day: string; rows: TraktActivity[] }[] = [];
    for (const row of rows) {
        const day = dayOf(row.at);
        if (days[days.length - 1]?.day === day) days[days.length - 1].rows.push(row);
        else days.push({ day, rows: [row] });
    }
    // Each day's band and titles share a wrapper, so the band stays at the top of the list while its titles scroll under it
    // and leaves with them.
    return days.map(({ day, rows: titles }) => (
        <div key={day} className='jfmod-traktDayGroup'>
            <div className='jfmod-traktDay' role='heading' aria-level={4}>{day}</div>
            {titles.map(row => <ActivityRow key={`${row.direction}-${row.user}-${row.state}-${row.at}-${row.title}-${row.code ?? ''}`} row={row} trakt={trakt} withUser={withUser} />)}
        </div>
    ));
};

/** The account bar while nobody is linked: the signed-in user and Connect Trakt, to the Trakt plugin's page (D128). */
const ConnectRow: FC<{ viewer: string }> = ({ viewer }) => (
    <div className='jfmod-brow jfmod-traktUser' data-jfmod-trakt-user=''>
        <TraktAvatar />
        <div className='jfmod-brow-main'>
            <strong>{viewer}<span className='jfmod-traktHandle'> · not connected to Trakt</span></strong>
            <span className='jfmod-sub'><StatePill kind='off'>Not connected</StatePill></span>
            <div className='fieldDescription'>
                Connect opens the Trakt plugin’s page in the Dashboard: choose {viewer}, authorize, and enter the code on trakt.tv/activate.
            </div>
            <div className='jfmod-inlineactions'>
                <Button variant='contained' href={TRAKT_PLUGIN_PAGE} data-jfmod-trakt-connect=''>Connect Trakt</Button>
            </div>
        </div>
    </div>
);

/** The account's Trakt avatar, or the person glyph on the grey disc when there is none (D70). */
const TraktAvatar: FC<{ url?: string | null }> = ({ url }) => {
    const [failed, setFailed] = useState<string | null>(null);
    const onError = useCallback(() => setFailed(url ?? null), [url]);
    if (url && failed !== url) return <img className='jfmod-traktAvatar' src={url} alt='' aria-hidden='true' referrerPolicy='no-referrer' onError={onError} />;
    return <span className='jfmod-traktAvatar jfmod-traktAvatar-none' aria-hidden='true'><PersonIcon /></span>;
};

/**
 * Settings › Trakt (Phase 13): missed watches to Trakt. JellyfinMod never talks to Trakt; it runs the stock Trakt plugin's
 * own export, which sends each watched episode Trakt does not have yet with the time it was watched. The section shows,
 * in order (D128): each linked account, with Reconnect Trakt when the plugin's sign-in could not be renewed, or Connect Trakt
 * while nobody is linked; the automatic and import switches (dimmed until an account is linked, D129); the export's state and
 * Sync Missing Watches Now; and Activity, one row per title of the last 30 days (D125). Design: `reviews/phase13/mockups-v3`.
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

    // Nobody connected: the switches and Sync Now stay in place, dimmed and still focus stops, and ignore presses (D129).
    // Only while the Trakt plugin can be used: a missing or too old plugin, or unreadable settings, show their refusal instead.
    const unlinked = !!trakt && trakt.installed && trakt.refusal !== 'old_plugin' && trakt.refusal !== 'unknown' && !trakt.users.length;
    const save = useCallback((change: { autoExport?: boolean; import?: boolean }) => {
        // While a change is saved the switch stays focusable (aria-disabled, so a TV keeps its focus) and ignores presses.
        if (busy || unlinked) return;
        setBusy(true);
        setNotice(null);
        request(api, 'PUT', 'Trakt/Export/Settings', change)
            .then(() => refresh())
            .catch(error => setNotice({ kind: 'err', text: problemText(error) }))
            .finally(() => setBusy(false));
    }, [api, busy, unlinked, refresh]);
    const toggle = useCallback((event: React.ChangeEvent<HTMLInputElement>) => save({ autoExport: event.target.checked }), [save]);
    const toggleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => save({ import: event.target.checked }), [save]);
    // Browsers toggle a checkbox on Space only; a remote has no Space, so its OK (Enter) toggles the switch too.
    const onEnter = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, change: () => { autoExport?: boolean; import?: boolean }) => {
        if (event.key !== 'Enter' || !trakt) return;
        event.preventDefault();
        // A held OK repeats its keydown: only the first press changes the switch.
        if (event.repeat) return;
        save(change());
    }, [save, trakt]);
    const toggleOnEnter = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => onEnter(event, () => ({ autoExport: !trakt?.autoExport })), [onEnter, trakt]);
    const toggleImportOnEnter = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => onEnter(event, () => ({ import: !trakt?.importEnabled })), [onEnter, trakt]);

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
        if (busy || refusal || unlinked) return;
        setBusy(true);
        setNotice(null);
        request(api, 'POST', 'Trakt/Export')
            .then(() => {
                setNotice({ kind: 'ok', text: 'The Trakt plugin’s export has started.' });
                return refresh();
            })
            .catch(error => setNotice({ kind: 'err', text: problemText(error) }))
            .finally(() => setBusy(false));
    }, [api, busy, refusal, unlinked, refresh]);

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
    // The no_users warning says what the account bar's Connect Trakt says, so it is left out while the bar shows it (D128).
    if (!shown && refusal && !unlinked) shown = { kind: 'warn', text: refusal };
    const blocked = !trakt.installed || trakt.refusal === 'old_plugin' || trakt.refusal === 'unknown';
    const off = unlinked ? ' jfmod-traktOff' : '';
    let syncTitle = refusal ?? (trakt.running ? 'The export is running' : undefined);
    if (unlinked) syncTitle = 'Connect a Trakt account first.';

    const lead = (
        <p className='fieldDescription jfmod-lead'>
            The Trakt plugin sends each watch to Trakt as it ends. A watch that ends while Trakt cannot be reached would be lost, so
            JellyfinMod runs the plugin’s own export once Trakt answers again: it sends every watched episode Trakt does not have yet,
            with the time you watched it, and leaves the episodes Trakt already has alone, so no play is counted twice. JellyfinMod
            never signs in to Trakt itself.
        </p>
    );

    return (
        <SectionFrame id='trakt' eyebrow={props.eyebrow} title='Trakt' state={summariseTrakt(trakt)} notice={shown} next={props.next} onGo={props.onGo}>
            {blocked && lead}
            {!blocked && (
                <>
                    {/* The account bar comes first (D128): each linked account, or the signed-in user with Connect Trakt. */}
                    <div className='jfmod-blist jfmod-traktAccount'>
                        {unlinked && <ConnectRow viewer={trakt.viewerName ?? 'You'} />}
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
                    {lead}
                    {unlinked && <p className='fieldDescription jfmod-traktConnectHint'>Connect a Trakt account to turn these on.</p>}
                    <div className={'jfmod-brow' + off} data-jfmod-trakt='auto'>
                        <div className='jfmod-brow-main'>
                            <FormControlLabel
                                // The key handler sits on the switch's root, which the input's keydown bubbles to: MUI 6 keeps
                                // only onChange of the input slot's handlers.
                                control={<Switch checked={trakt.autoExport} onChange={toggle} onKeyDown={toggleOnEnter}
                                    slotProps={{ input: { 'aria-disabled': busy || unlinked || undefined } }} />}
                                label='Send missed watches automatically' />
                            <div className='fieldDescription'>
                                {quietWords(trakt.quietMinutes)} after an episode ends, and again until it works. Off until you turn it on: the first
                                export also sends older watches that Trakt does not have.
                            </div>
                        </div>
                    </div>
                    <div className={'jfmod-brow' + off} data-jfmod-trakt='import'>
                        <div className='jfmod-brow-main'>
                            <FormControlLabel
                                control={<Switch checked={!!trakt.importEnabled} onChange={toggleImport} onKeyDown={toggleImportOnEnter}
                                    slotProps={{ input: { 'aria-disabled': busy || unlinked || undefined } }} />}
                                label='Also import watches from Trakt' />
                            <div className='fieldDescription'>
                                {importLine(trakt)}
                            </div>
                        </div>
                    </div>
                    <div className={'jfmod-brow' + off} data-jfmod-trakt='export'>
                        <div className='jfmod-brow-main'>
                            <strong data-jfmod-trakt-last=''>{lastRunLine(trakt)}</strong>
                            <span className='jfmod-sub' data-jfmod-trakt-next=''>{nextLine(trakt)}</span>
                            <div className='jfmod-inlineactions'>
                                <Button variant='contained' color='inherit' onClick={syncNow}
                                    aria-disabled={busy || !!refusal || unlinked || trakt.running ? true : undefined}
                                    title={syncTitle}>
                                    Sync Missing Watches Now
                                </Button>
                            </div>
                        </div>
                    </div>
                    {!unlinked && (
                        <div className={'jfmod-group jfmod-traktActivity' + (activityOpen ? ' is-open' : '')} data-jfmod-trakt='activity'>
                            {/* A group header in its own space with a Material chevron and the count, the same words open and closed (D153). */}
                            <button type='button' className={flatButtonClass() + ' jfmod-activityToggle'} aria-expanded={activityOpen}
                                onClick={toggleActivity}>
                                <ChevronRightIcon className='jfmod-activityChevron' aria-hidden='true' />
                                <span className='jfmod-activityTitle'>Activity</span>
                                <span className='jfmod-activityCount'>{plural(trakt.activity?.length ?? 0, 'title')} in the last 30 days</span>
                            </button>
                            {activityOpen && (
                                <ScrollList label='Trakt activity, the last 30 days, newest first'>
                                    {activityRows(trakt)}
                                </ScrollList>
                            )}
                        </div>
                    )}
                </>
            )}
            {confirmDialog}
        </SectionFrame>
    );
};
