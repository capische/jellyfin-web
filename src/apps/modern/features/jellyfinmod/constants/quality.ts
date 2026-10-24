/**
 * How a quality is written for people (user, 2026-10-15: "can these to be pretty printed? even for Order tried?"; "You can put
 * 'torrent names' into some config or hardcode for now"): the resolution's name, then the source's, as in `4K Remux`,
 * `2K WEB-DL`, `1080p Blu-ray`. The plugin's ids (`remux-2160p`) stay in the data and the API. These two maps are the one
 * place the names live; a later configuration replaces them here.
 */
const RESOLUTION_NAMES = new Map([['2160p', '4K'], ['1440p', '2K']]);
const SOURCE_NAMES = new Map([
    ['remux', 'Remux'], ['bluray', 'Blu-ray'], ['webdl', 'WEB-DL'], ['webrip', 'WEBRip'], ['hdtv', 'HDTV'], ['dvd', 'DVD'], ['cam', 'CAM'],
    ['disc', 'Full Disc']
]);

/**
 * `4K WEB-DL` from a parsed resolution and source; empty when neither is known. A Blu-ray encode the release calls a rip
 * keeps that word (`4K BDRip`, P4.FU22): the same tier as `4K Blu-ray`, a different label.
 */
export const qualityLabel = (resolution: string | null | undefined, source: string | null | undefined, rip?: string | null) => {
    const sourceName = source ? SOURCE_NAMES.get(source) ?? source : null;
    return [resolution ? RESOLUTION_NAMES.get(resolution) ?? resolution : null, source === 'bluray' && rip ? rip : sourceName]
        .filter(Boolean).join(' ');
};

/** `4K Remux` from a quality id (`remux-2160p`); an id it cannot read is shown as it is. */
export const qualityName = (id: string | null | undefined) => {
    if (!id) return '';
    const [source, resolution] = id.split('-');
    return resolution ? qualityLabel(resolution, source) : id;
};
