// Minimal bencode for the S11 stand-ins: decode keeps the byte range of every value, so the info hash is the SHA-1 of
// the exact bytes the torrent carried, as a real client computes it.
import { createHash } from 'node:crypto';

export function decode(buffer, start = 0) {
    let at = start;
    const next = () => {
        const from = at;
        const c = buffer[at];
        if (c === 0x69) { // i
            const end = buffer.indexOf(0x65, at);
            const value = Number(buffer.toString('latin1', at + 1, end));
            at = end + 1;
            return { value, from, to: at };
        }
        if (c === 0x6c) { // l
            at++;
            const list = [];
            while (buffer[at] !== 0x65) list.push(next());
            at++;
            return { value: list, from, to: at };
        }
        if (c === 0x64) { // d
            at++;
            const dict = {};
            while (buffer[at] !== 0x65) {
                const key = next();
                dict[key.value.toString('latin1')] = next();
            }
            at++;
            return { value: dict, from, to: at };
        }
        const colon = buffer.indexOf(0x3a, at);
        const length = Number(buffer.toString('latin1', at, colon));
        const value = buffer.subarray(colon + 1, colon + 1 + length);
        at = colon + 1 + length;
        return { value, from, to: at };
    };
    return next();
}

export function encode(value) {
    if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
    if (typeof value === 'string') return encode(Buffer.from(value, 'utf8'));
    if (typeof value === 'number') return Buffer.from(`i${Math.trunc(value)}e`);
    if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...value.map(encode), Buffer.from('e')]);
    const keys = Object.keys(value).sort();
    return Buffer.concat([Buffer.from('d'), ...keys.flatMap(key => [encode(key), encode(value[key])]), Buffer.from('e')]);
}

/** Reads a .torrent: its info hash, name and files (single- or multi-file). */
export function readTorrent(bytes) {
    const root = decode(bytes);
    const info = root.value.info;
    const infoHash = createHash('sha1').update(bytes.subarray(info.from, info.to)).digest('hex');
    const name = info.value.name.value.toString('utf8');
    const files = info.value.files
        ? info.value.files.value.map(file => ({
            name: [name, ...file.value.path.value.map(part => part.value.toString('utf8'))].join('/'),
            length: file.value.length.value
        }))
        : [{ name, length: info.value.length.value }];
    return { infoHash, name, files };
}
