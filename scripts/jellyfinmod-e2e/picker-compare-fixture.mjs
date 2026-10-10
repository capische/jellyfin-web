/* eslint-disable compat/compat -- a Node acceptance runner, not shipped code */
// The mock's results cell as a ReleaseSearch answer, so the real dialog renders the same rows.
const row = (n, o) => ({
    releaseId: 'rel' + n, indexerId: '00000000-0000-0000-0000-00000000000' + (o.ix ?? 1), indexerName: o.indexer, rawTitle: o.raw,
    parsed: { title: 'The Series', year: null, seasonNumber: 2, episodeNumbers: [4], seasonPack: false, absoluteNumbering: false, dailyNumbering: false,
        resolution: o.res, source: o.source ?? 'webdl', codec: o.codec, audio: o.audio, hdr: o.hdr ?? null, group: null, proper: !!o.proper, repack: false, quality: 'x',
        languages: o.langs ?? [], subtitles: o.subs ?? [], audioChannels: o.ch ?? null },
    match: { identity: 'verified', method: 'tvdbid' }, size: o.size, seeders: o.seeds, peers: o.seeds + 3, publishedAt: null, freeleech: o.fl ? true : null,
    proper: !!o.proper, repack: false, infoHash: null, sameHashReleaseIds: [], score: o.score, contributions: [], eligible: !o.rejected, rejections: o.rejected ? [{ code: 'x', message: o.rejected }] : [],
    seedRatio: null, seedMinutes: null, heldQuality: !!o.held, coverage: null
});
export const candidates = [
    row(1, { indexer: 'TorrentGalaxy', raw: 'The.Series.S02E04.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10Plus.H.265-FLUX', res: '2160p', codec: 'h265', hdr: 'DV HDR10+', audio: 'TrueHD Atmos', ch: '7.1', langs: ['EN'], subs: ['EN', 'ES', 'FR', 'DE'], size: 9.8e9, seeds: 21, fl: true, score: 870 }),
    row(2, { indexer: '1337x', raw: 'The.Series.S02E04.The.Long.Night.1080p.AMZN.WEB-DL.DDP5.1.H.265-NTb', res: '1080p', codec: 'h265', audio: 'DD+', ch: '5.1', langs: ['EN'], subs: ['EN', 'ES'], size: 2.1e9, seeds: 48, score: 640 }),
    row(3, { indexer: 'TorrentGalaxy', raw: 'The.Series.S02E04.PROPER.1080p.BluRay.x264.DTS-HD.MA.7.1-FraMeSToR', res: '1080p', source: 'bluray', codec: 'h264', audio: 'DTS-HD MA', ch: '7.1', langs: ['EN', 'DE'], subs: ['EN', 'DE', 'FR'], size: 4.6e9, seeds: 12, proper: true, score: 820 }),
    row(4, { indexer: 'Nyaa', raw: 'The.Series.S02E04.1080p.WEB.H264-ION10', res: '1080p', codec: 'h264', audio: 'AAC', ch: '2.0', langs: ['EN', 'JA'], subs: ['EN'], size: 1.7e9, seeds: 9, held: true, score: 500 }),
    row(5, { indexer: '1337x', raw: 'The.Series.S02E04.720p.WEB.x264-minX', res: '720p', codec: 'h264', audio: 'AAC', ch: '2.0', langs: ['EN'], size: 0.9e9, seeds: 30, fl: true, score: 400 }),
    row(6, { indexer: '1337x', raw: 'The.Series.S02E04.DVDRip.XviD-RARBG', res: '480p', source: 'dvd', codec: 'xvid', audio: 'MP3', ch: '2.0', langs: ['EN'], size: 0.4e9, seeds: 3, rejected: "Below the profile's minimum quality (720p).", score: 100 }),
    row(7, { indexer: 'Nyaa', raw: 'the.series.s02e04.1080p.web.x264', res: '1080p', codec: 'h264', audio: 'AAC', ch: '2.0', size: 1.9e9, seeds: 0, rejected: 'No seeders.', score: 90 })
];
export const search = episodeId => ({
    searchId: '11111111-1111-1111-1111-111111111111', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 6e5).toISOString(), intent: 'addVersion',
    target: { entryId: 'c01abd2729544572a95cafed3744429b', episodeId, mediaType: 'series', title: 'Peep Show', year: 2003, seasonNumber: 1, episodeNumber: 1, scope: 'episode', covered: [] },
    profile: { id: '8449e0d6dc9a48968e78037285b20b51', name: 'HD-1080p', revision: 1, inherited: true },
    grab: { available: true, reason: null, holdSeconds: 5, activeOperationId: null, modes: ['add', 'replace'] },
    candidates, eligibleCount: 5, rejectedCount: 2, partial: true, truncated: false,
    indexers: [
        { indexerId: '00000000-0000-0000-0000-000000000002', name: '1337x', status: 'ok', message: null, resultCount: 3, truncated: false, retryAfterSeconds: null },
        { indexerId: '00000000-0000-0000-0000-000000000001', name: 'TorrentGalaxy', status: 'ok', message: null, resultCount: 3, truncated: false, retryAfterSeconds: null },
        { indexerId: '00000000-0000-0000-0000-000000000003', name: 'Nyaa', status: 'ok', message: null, resultCount: 2, truncated: false, retryAfterSeconds: null },
        { indexerId: '00000000-0000-0000-0000-000000000004', name: 'RARBG', status: 'breaker_open', message: 'paused until 16:05', resultCount: 0, truncated: false, retryAfterSeconds: 600 }
    ]
});
export const progress = () => ({ finished: false, indexers: [
    { indexerId: '00000000-0000-0000-0000-000000000002', name: '1337x', state: 'ok', startedAt: null, resultCount: 14, retryAfterSeconds: null },
    { indexerId: '00000000-0000-0000-0000-000000000001', name: 'TorrentGalaxy', state: 'asking', startedAt: new Date(Date.now() - 6000).toISOString(), resultCount: 0, retryAfterSeconds: null },
    { indexerId: '00000000-0000-0000-0000-000000000003', name: 'Nyaa', state: 'queued', startedAt: null, resultCount: 0, retryAfterSeconds: null },
    { indexerId: '00000000-0000-0000-0000-000000000004', name: 'RARBG', state: 'breaker_open', startedAt: null, resultCount: 0, retryAfterSeconds: 600 }
] });
