/* eslint-disable sonarjs/no-os-command-from-path -- a Node helper for the parity runner, not shipped code */
// Database-level user-data evidence for the parity run (P7.S11).
//
// The API's UserData DTO does not carry the remembered audio and subtitle selection (UserData.AudioStreamIndex /
// SubtitleStreamIndex), and it hides the plugin's retention bookkeeping, so "restored field for field" is proven on
// COPIES of the two SQLite databases, read over SSH on the test host. Nothing is written on the host except a
// temporary directory that is removed again; the live databases are only copied.
//
//   JELLYFINMOD_SSH_HOST   ssh alias of the test host (required)
//   JELLYFINMOD_DATA_DIR   the instance's Jellyfin data directory on that host, the one holding jellyfin.db (required)
//   JELLYFINMOD_TEST_USER  default oleksii
//
//   node userdata-db.mjs snapshot <out.txt>              every UserData row of the user + their CompletionObservations
//   node userdata-db.mjs stream-map <snapshot.txt> <out.json>   itemId -> { a, s } for JELLYFINMOD_PARITY_STREAM_MEMORY
//   node userdata-db.mjs diff <before.txt> <after.txt>   exit 0 when every UserData row is equal; completion rows by column
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [mode, first, second] = process.argv.slice(2);
const user = process.env.JELLYFINMOD_TEST_USER ?? 'oleksii';

const snapshot = () => {
    const host = process.env.JELLYFINMOD_SSH_HOST;
    const dataDir = process.env.JELLYFINMOD_DATA_DIR;
    if (!host || !dataDir) throw new Error('JELLYFINMOD_SSH_HOST and JELLYFINMOD_DATA_DIR are required');
    if (!/^[A-Za-z0-9_.-]+$/.test(user)) throw new Error('unexpected user name');
    const script = `set -e
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
D=${JSON.stringify(dataDir)}
cp "$D/jellyfin.db" "$T/"; [ -f "$D/jellyfin.db-wal" ] && cp "$D/jellyfin.db-wal" "$T/"
cp "$D/jellyfinmod/jellyfinmod.db" "$T/jm.db"; [ -f "$D/jellyfinmod/jellyfinmod.db-wal" ] && cp "$D/jellyfinmod/jellyfinmod.db-wal" "$T/jm.db-wal"
cd "$T"
U=$(sqlite3 jellyfin.db "select Id from Users where Username='${user}';")
echo "#userdata"
sqlite3 -separator '|' jellyfin.db "select ItemId, CustomDataKey, ifnull(AudioStreamIndex,'null'), ifnull(SubtitleStreamIndex,'null'), IsFavorite, ifnull(LastPlayedDate,'null'), ifnull(Likes,'null'), PlayCount, PlaybackPositionTicks, Played, ifnull(Rating,'null'), ifnull(RetentionDate,'null') from UserData where UserId='$U' order by ItemId, CustomDataKey;"
echo "#completion"
sqlite3 -separator '|' jm.db "select * from CompletionObservations where lower(replace(UserId,'-',''))=lower(replace('$U','-','')) order by 1;"
`;
    return execFileSync('ssh', [host, 'bash -s'], { input: script, maxBuffer: 1 << 28 }).toString();
};

const section = (text, name) => {
    const lines = text.split('\n');
    const start = lines.indexOf('#' + name);
    const out = [];
    for (let i = start + 1; i < lines.length && !lines[i].startsWith('#'); i++) if (lines[i]) out.push(lines[i]);
    return out;
};

const COMPLETION_COLUMNS = ['Id', 'EntryId', 'EpisodeId', 'TargetId', 'UserId', 'JellyfinItemId', 'EvidenceAvailable', 'Played',
    'IsFavorite', 'PlaybackPositionTicks', 'LastPlayedAt', 'CompletedAt', 'ObservedAt', 'SourceReason'];

if (mode === 'snapshot') {
    fs.writeFileSync(first, snapshot());
    const text = fs.readFileSync(first, 'utf8');
    console.log(JSON.stringify({ userDataRows: section(text, 'userdata').length, completionRows: section(text, 'completion').length }));
} else if (mode === 'stream-map') {
    const map = {};
    for (const line of section(fs.readFileSync(first, 'utf8'), 'userdata')) {
        const [item, , a, s] = line.split('|');
        const id = item.replace(/-/g, '').toLowerCase();
        map[id] ??= { a: a === 'null' ? null : Number(a), s: s === 'null' ? null : Number(s) };
    }
    fs.writeFileSync(second, JSON.stringify(map));
    console.log(JSON.stringify({ items: Object.keys(map).length }));
} else if (mode === 'diff') {
    const [before, after] = [first, second].map(file => fs.readFileSync(file, 'utf8'));
    const rowsBefore = section(before, 'userdata');
    const rowsAfter = section(after, 'userdata');
    const setAfter = new Set(rowsAfter);
    const setBefore = new Set(rowsBefore);
    const userData = {
        rowsBefore: rowsBefore.length, rowsAfter: rowsAfter.length,
        onlyBefore: rowsBefore.filter(row => !setAfter.has(row)), onlyAfter: rowsAfter.filter(row => !setBefore.has(row))
    };
    const byId = rows => new Map(rows.map(row => [row.split('|')[0], row.split('|')]));
    const [cb, ca] = [byId(section(before, 'completion')), byId(section(after, 'completion'))];
    const changedColumns = {};
    for (const [id, row] of cb) {
        const other = ca.get(id);
        if (!other) continue;
        row.forEach((value, i) => {
            if (value !== other[i]) changedColumns[COMPLETION_COLUMNS[i]] = (changedColumns[COMPLETION_COLUMNS[i]] ?? 0) + 1;
        });
    }
    const completion = {
        rowsBefore: cb.size, rowsAfter: ca.size,
        added: [...ca.keys()].filter(id => !cb.has(id)).length, removed: [...cb.keys()].filter(id => !ca.has(id)).length, changedColumns
    };
    console.log(JSON.stringify({ userData, completion }, null, 1));
    const identical = !userData.onlyBefore.length && !userData.onlyAfter.length;
    process.exitCode = identical ? 0 : 1;
} else {
    console.error('usage: node userdata-db.mjs snapshot <out> | stream-map <snapshot> <out.json> | diff <before> <after>');
    process.exitCode = 2;
}
/* eslint-enable sonarjs/no-os-command-from-path -- closes the file-level exemption above */
