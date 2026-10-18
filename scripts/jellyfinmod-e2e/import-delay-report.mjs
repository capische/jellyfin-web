// Summarize a recording from import-delay.mjs; --verify fails if a cloud appeared after the download ring.
// node import-delay-report.mjs <recording.json> [--verify]
import { readFileSync } from 'node:fs';

const recording = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = [];
let failed = false;
const normal = id => id?.replaceAll('-', '').toLowerCase();
for (const c of recording.cases) {
    const seconds = at => at == null ? null : +((at - c.finishedAt) / 1000).toFixed(3);
    const stamp = value => value ? Date.parse(value) : null;
    const links = c.operations.map(o => stamp(o.linkedAt)).filter(Boolean);
    const done = c.operations.map(o => stamp(o.completedAt)).filter(Boolean);
    const count = c.finalItems?.length ?? 0;
    const finalIds = new Set(c.finalItems?.map(i => normal(i.id)));
    const stubIds = new Set(c.events.find(e => e.kind === 'items-by-original-id')?.data.map(i => normal(i.id)));
    const native = c.events.find(e => e.kind === 'items-by-parent' && e.data.length === count && count
        && e.data.every(i => !i.placeholder && i.path?.endsWith('.mkv')
            && i.sources?.some(source => source.MediaStreams?.some(stream => stream.Type === 'Video'))));
    for (const [surface, samples] of Object.entries(c.dom)) {
        if (surface.startsWith('ordinary')) {
            // An ordinary user cannot read the queue, so there is no ring; the page is moved by the plugin's push or the one fallback.
            const after = samples.filter(s => s.at >= c.finishedAt);
            const play = after.find(s => s.rows?.length && s.rows.every(r => r.play && !r.cloud && !r.placeholder));
            const reads = c.network.filter(e => e.surface === surface && e.at >= c.finishedAt && /\/JellyfinMod\/Entries\/[0-9a-f-]{32,36}$/.test(e.path));
            const converged = play ? reads.filter(e => e.at <= play.at + 2000).length : reads.length;
            rows.push({ case: c.case, surface, play: seconds(play?.at), entryDetailReads: reads.length, entryDetailReadsToPlay: converged,
                readTimes: reads.slice(0, 30).map(e => seconds(e.at)) });
            if (!play) failed = true;
            continue;
        }
        // The window opens at the first ring after the download finished, in whatever state the page's last queue read had.
        const firstRing = samples.find(s => s.at >= c.finishedAt && s.rows?.some(r => r.ring));
        const active = samples.filter(s => firstRing && s.at >= firstRing.at);
        const gap = active.filter(s => s.rows?.some(r => r.cloud && !r.ring));
        const ringGone = active.find(s => s.rows?.length && s.rows.every(r => !r.ring));
        const play = active.find(s => s.rows?.length && s.rows.every(r => r.play && !r.cloud));
        const websocket = c.websockets.find(e => e.surface === surface && e.at >= Math.max(...links)
            && ([...(e.data.ItemsAdded ?? []), ...(e.data.ItemsUpdated ?? [])].some(id => finalIds.has(normal(id)))
                || (e.data.ItemsRemoved ?? []).some(id => stubIds.has(normal(id)))));
        const read = c.network.find(e => e.surface === surface && native && e.at >= native.at && e.status === 200
            && (/\/Shows\//.test(e.path) || /\/JellyfinMod\/Entries\//.test(e.path)));
        const intervals = samples.slice(1).map((s, i) => s.at - samples[i].at).sort((a, b) => a - b);
        const row = { case: c.case, surface, linked: links.map(seconds), nativePlayable: seconds(native?.at),
            completed: done.map(seconds), libraryChanged: seconds(websocket?.at), webReread: seconds(read?.at),
            ringGone: seconds(ringGone?.at), play: seconds(play?.at), cloudSamples: gap.length,
            cloudGapSeconds: gap.length ? +((gap.at(-1).at - gap[0].at + 100) / 1000).toFixed(3) : 0,
            sampleIntervalP99Ms: intervals[Math.floor(intervals.length * 0.99)] };
        rows.push(row);
        if (!firstRing || !native || !play || gap.length) failed = true;
    }
}
console.log(JSON.stringify({ label: recording.label, tier: recording.tier, build: recording.build, rows }, null, 2));
if (process.argv.includes('--verify') && failed) process.exitCode = 1;
