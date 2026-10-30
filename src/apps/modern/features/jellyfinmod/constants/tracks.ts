import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';

/**
 * What an Audio or Subtitles row says beyond its language and format marks (the track rows redesign, user-approved 2026-10-29,
 * decisions D59–D63, D75–D83; mockup `reviews/track-row-icons/mock.html`, whose `detect()`, `MODIFIERS` and `extraWords()` these
 * follow): one role mark, a short modifier after the language, and the title's own extra words. A track's title is never drawn
 * as it is; Default, Original, External and Full are not shown.
 */

/** One role mark per row, the first that applies (D61, D63, D79, D80). `comm` is drawn as a glyph, the rest as their word. */
export type TrackRole = 'AD' | 'comm' | 'DUB' | 'MVO' | 'DVO' | 'AVO' | 'VO' | 'SIGNS' | 'FORCED' | 'SDH';

/** The role's name for a tooltip and a screen reader. */
export const TRACK_ROLE_NAME: Record<TrackRole, string> = {
    AD: 'Audio description',
    comm: 'Commentary',
    DUB: 'Dubbed',
    MVO: 'Multi-voice voice-over',
    DVO: 'Two-voice voice-over',
    AVO: 'Author’s voice-over',
    VO: 'Voice-over',
    SIGNS: 'Signs and songs only',
    FORCED: 'Forced (only the foreign lines)',
    SDH: 'For the deaf and hard of hearing'
};

/** The translation type as the release writes it; a bare "VO" is never read (French releases use it for the original). */
const translation = (text: string): TrackRole | null => {
    if (/\bdub\b|dubbed|дубляж|дублир|дубльов|吹替|吹き替え/.test(text)) return 'DUB';
    if (/\bmvo\b|многоголос|багатоголос/.test(text)) return 'MVO';
    if (/\bdvo\b|двухголос|двоголос/.test(text)) return 'DVO';
    if (/\bavo\b|авторск|авторськ/.test(text)) return 'AVO';
    if (/voice[- ]?over|закадров|одноголос/.test(text)) return 'VO';
    return null;
};

/** Words that negate the word after them ("not forced", "pas forcés", "sin forzados", "keine erzwungenen", "без …"). */
const NEGATIONS = new Set(['not', 'non', 'no', 'pas', 'sin', 'keine', 'kein', 'nicht', 'не', 'без']);

/**
 * Whether a title calls the track forced (D167): a word that starts as a forced word (forced, forcé, forzado, форс…, erzwungen)
 * and is not right after a negation word. A prefixed word ("unforced", "Нефорсированные") does not start as one, and
 * "non-forced" splits into two words. Words are split on anything that is not a Latin or Cyrillic letter, so runs of spaces do
 * not matter.
 */
const saysForced = (text: string) => {
    // Latin with its accents and Cyrillic (no `\p{L}`: the build targets ES5).
    const words = text.split(/[^a-z\u00c0-\u024f\u0400-\u04ff]+/).filter(Boolean);
    return words.some((word, index) => /^(?:forced|forcé|forzad|форс|erzwung)/.test(word) && !NEGATIONS.has(words[index - 1] ?? ''));
};

/**
 * The stream's role, stream flags first, then title words (D62). Audio: audio description, then commentary ("тифлокомментарий"
 * holds "комментарий", so AD is tested first), then the translation type. Subtitles: SIGNS when the title says signs / songs /
 * S&S / надписи (it wins over the flag), FORCED for the flag or "forced", then SDH (a partial track is the one to warn about).
 */
export const trackRole = (stream: MediaStream): TrackRole | null => {
    const raw = stream.Title ?? '';
    const text = raw.toLowerCase();
    if (stream.Type === 'Audio') {
        if (/\bAD\b/.test(raw) || /audio[ -]?descri|descriptive|described video|\bdvs\b|тифло|аудиоописан|аудіоопис|audiodeskription|audiodescri/.test(text)) {
            return 'AD';
        }
        if (/comment|коммент|комент|kommentar|commentaire|comentar|commento|comentário|コメンタリー/.test(text)) return 'comm';
        return translation(text);
    }
    if (/signs|songs|\bs&s\b|надпис|напис/.test(text)) return 'SIGNS';
    if (stream.IsForced || saysForced(text)) return 'FORCED';
    // The acronyms as whole words in any case, as the extra words strip them ("English sdh"); "hi-fi" is not HI.
    if (stream.IsHearingImpaired || /\b(?:sdh|cc)\b|\bhi\b(?!-fi)/.test(text)
        || /hearing impaired|deaf|слабослыш|глух|порушенням слуху|hörgeschädigt|sourds/.test(text)) return 'SDH';
    return null;
};

/** The short modifier after the language (D60): a fixed table only, never free text, at most 6 characters. */
const MODIFIERS: Array<[RegExp, string]> = [
    [/brazil|brasil|pt-br|\bbr\b/, 'BR'], [/european|portugal|pt-pt/, 'PT'],
    [/latin|latino|latam|es-419|méxico|mexico/, 'LatAm'], [/castilian|castellano|españa|spain|es-es/, 'ES'],
    [/simplified|简体|\bchs\b|zh-hans/, 'Simpl.'], [/traditional|繁體|繁体|\bcht\b|zh-hant/, 'Trad.'], [/cantonese|粵語|粤语/, 'Cant.'],
    [/canadian|québ|quebec|\bvfq\b|fr-ca/, 'CA'], [/\bvff\b|fr-fr/, 'FR'],
    [/american|en-us|\bus\b/, 'US'], [/british|en-gb|\buk\b/, 'UK']
];

export const trackModifier = (stream: MediaStream): string | null => {
    const text = (stream.Title ?? '').toLowerCase();
    return MODIFIERS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
};

/** Words a row already shows, in English, Russian, Ukrainian and Japanese (D81), trimmed from a title's start and end. */
const KNOWN = new Set(('original default forced sdh cc hi full audio track subtitles subs stereo mono surround aac ac3 eac3 dd ddp dd+ '
    + 'dolby digital plus dts hd ma x truehd atmos flac opus mp3 pcm lpcm 1.0 2.0 5.1 6.1 7.1 ch srt ass ssa pgs vobsub '
    + 'english russian ukrainian japanese spanish portuguese french german chinese eng rus ukr jpn spa por fre fra ger deu chi zho '
    + 'русский украинский українська английский английская оригинал оригінал '
    + 'dub dubbed дубляж дублированный дубльований mvo dvo avo vo svo закадровый многоголосый двухголосый авторский одноголосый '
    + 'signs songs & s&s надписи написи форсированные полные повні для слабослышащих für hörgeschädigte '
    + 'latin american castilian brazilian simplified traditional '
    // The role words the role mark already says (D81), beyond the mockup's list: a track titled "Commentary" adds nothing.
    + 'commentary комментарий коментар kommentar commentaire comentario commento description descriptive').split(' '));
const CJK_KNOWN = ['日本語', '吹替', '吹き替え', '简体', '繁體', '繁体'];

/** `text` without the given characters at either end. */
const trimChars = (text: string, chars: string) => {
    let start = 0;
    let end = text.length;
    while (start < end && chars.includes(text[start])) start++;
    while (end > start && chars.includes(text[end - 1])) end--;
    return text.slice(start, end);
};

/**
 * The words a title adds to what the row shows (D81), from its start and its end only: "Дубляж Мосфильм" → "Мосфильм",
 * "Дубляж (Blu-ray CEE)" → "Blu-ray CEE", "MVO (LostFilm)" → "LostFilm"; a phrase whose first word is not a known one stays
 * whole; "Дубляж [UKR]", "Original [ENG]", "日本語吹替" add nothing (empty).
 */
export const trackExtraWords = (stream: MediaStream): string => {
    let title = stream.Title ?? '';
    for (const word of CJK_KNOWN) title = title.split(word).join(' ');
    const tokens = title.split(/\s+/).filter(Boolean);
    const known = (word: string) => {
        const bare = trimChars(word.toLowerCase(), '[](){}-_,;:/|.');
        return bare === '' || KNOWN.has(bare) || (bare.length <= 3 && /^[a-z]+$/.test(bare) && /^\[.*\]$/.test(word));
    };
    while (tokens.length && known(tokens[0])) tokens.shift();
    // A known word after a negation stays with it: "English (not forced)" adds "not forced", not "not".
    const negated = () => tokens.length > 1 && NEGATIONS.has(trimChars(tokens[tokens.length - 2].toLowerCase(), '[](){}-_,;:/|.'));
    while (tokens.length && known(tokens[tokens.length - 1]) && !negated()) tokens.pop();
    return trimChars(tokens.join(' '), '[](){}-–,;: ');
};
