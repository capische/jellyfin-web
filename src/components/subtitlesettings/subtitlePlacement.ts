/**
 * Subtitle placement resolution.
 *
 * A placement is the corner a subtitle profile occupies. It resolves to a band (the
 * horizontal strip it lives in) and an alignment within that band. Layers sharing a band are
 * laid out as flex siblings, so they can never overlap; the only question is whether they
 * stack (column) or sit next to each other (row).
 *
 * When they stack, the secondary takes the edge of the band and the primary sits inboard of
 * it. Both measure their offset from that same edge, so neither slider changes meaning when
 * the other profile is turned on.
 *
 * @module components/subtitleSettings/subtitlePlacement
 */

export const SubtitlePosition = {
    Top: 'top',
    Bottom: 'bottom',
    BottomLeft: 'bottom-left',
    BottomRight: 'bottom-right'
} as const;

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type SubtitlePosition = typeof SubtitlePosition[keyof typeof SubtitlePosition];

export const DEFAULT_SUBTITLE_POSITION: SubtitlePosition = SubtitlePosition.Bottom;

/** The horizontal strip a subtitle occupies. */
export type SubtitleBand = 'top' | 'bottom';

/** Alignment within the band, in writing-direction-agnostic flex terms. */
export type SubtitleAlign = 'start' | 'center' | 'end';

export interface ResolvedPlacement {
    band: SubtitleBand;
    align: SubtitleAlign;
}

const PLACEMENTS: Record<SubtitlePosition, ResolvedPlacement> = {
    [SubtitlePosition.Top]: { band: 'top', align: 'center' },
    [SubtitlePosition.Bottom]: { band: 'bottom', align: 'center' },
    [SubtitlePosition.BottomLeft]: { band: 'bottom', align: 'start' },
    [SubtitlePosition.BottomRight]: { band: 'bottom', align: 'end' }
};

/**
 * Resolve a stored position value to its band and alignment, falling back to the default for
 * anything unrecognised (including settings saved before the position field existed).
 */
export function resolvePlacement(position: string | undefined | null): ResolvedPlacement {
    return PLACEMENTS[position as SubtitlePosition] || PLACEMENTS[DEFAULT_SUBTITLE_POSITION];
}

/**
 * How two layers sharing a band should be laid out.
 *
 * Same alignment means one has to go above the other, so they stack. Different alignments
 * (Bottom Left + Bottom Right) means they can share a line without touching.
 */
export type BandLayout = 'column' | 'row';

export function getBandLayout(primary: ResolvedPlacement, secondary: ResolvedPlacement): BandLayout {
    return primary.align === secondary.align ? 'column' : 'row';
}

/**
 * Lines of vertical space held for the secondary when it is stacked with the primary.
 *
 * The reservation is what keeps the two layers still. Without it the secondary's box is
 * content-sized, so the primary — which sits on top of it — would slide down every time the
 * secondary ran out of cues and back up when the next one arrived. Two lines covers what a
 * secondary track realistically shows; a longer cue grows past the reservation rather than
 * being clipped.
 */
export const RESERVED_SECONDARY_LINES = 2;

/** Whether the two layers are stacked one above the other in a shared band. */
export function isStacked(
    primaryPosition: string | undefined | null,
    secondaryPosition: string | undefined | null,
    hasSecondary = true
): boolean {
    const primary = resolvePlacement(primaryPosition);
    const secondary = resolvePlacement(secondaryPosition);

    return hasSecondary
        && primary.band === secondary.band
        && getBandLayout(primary, secondary) === 'column';
}

/** Pixel geometry for a stacked pair, all of it derived from settings alone. */
export interface StackGeometry {
    /** Fixed height of the secondary's slot. */
    secondaryReserve: number;
    /** Distance from the primary's slot to the secondary's, which may be zero. */
    primaryGap: number;
}

/**
 * Lay out a stacked pair so neither layer can be moved by the other's content.
 *
 * The secondary owns the edge of the band and measures from it. The primary measures from
 * the same edge, but is pushed clear of the secondary's reserved slot when its own offset
 * would put it inside: its final distance from the edge is the larger of the two. Both
 * numbers come from the stored settings, so no cue appearing or disappearing can shift
 * either layer.
 *
 * @param primaryOffset distance the primary asks to sit from the band edge, in px
 * @param secondaryOffset distance the secondary sits from the band edge, in px
 * @param secondaryLineHeight rendered height of one line of secondary text, in px
 */
export function getStackGeometry(
    primaryOffset: number,
    secondaryOffset: number,
    secondaryLineHeight: number
): StackGeometry {
    const secondaryReserve = RESERVED_SECONDARY_LINES * secondaryLineHeight;

    return {
        secondaryReserve,
        primaryGap: Math.max(0, primaryOffset - secondaryOffset - secondaryReserve)
    };
}

interface MigratableSettings {
    position?: string;
    verticalPosition?: number | string;
}

/**
 * Backfill `position` for settings saved before it existed.
 *
 * The old `verticalPosition` was a signed line number: negative anchored to the bottom with a
 * `|pos + 1|` line margin, positive anchored to the top with a `pos` line margin. The sign is
 * now carried by `position`, so it is folded into a band and the value becomes an unsigned
 * magnitude.
 *
 * A secondary profile's old value was an absolute screen position, so there is nothing
 * meaningful to carry over — it resets to `0`, flush against the band edge, which is where a
 * secondary usually wants to be anyway.
 *
 * Mutates and returns the passed object, matching how `getSubtitleAppearanceSettings` builds
 * its result.
 */
export function migratePlacement<T extends MigratableSettings>(settings: T, isSecondary = false): T {
    if (settings.position) return settings;

    const pos = parseInt(String(settings.verticalPosition), 10);
    if (isNaN(pos)) {
        settings.position = DEFAULT_SUBTITLE_POSITION;
        return settings;
    }

    if (pos < 0) {
        settings.position = SubtitlePosition.Bottom;
        settings.verticalPosition = isSecondary ? 0 : Math.abs(pos) - 1;
    } else {
        settings.position = SubtitlePosition.Top;
        settings.verticalPosition = isSecondary ? 0 : pos;
    }

    return settings;
}

const ALIGN_TO_FLEX: Record<SubtitleAlign, string> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end'
};

/** CSS `align-self` value for a resolved alignment. */
export function getFlexAlign(align: SubtitleAlign): string {
    return ALIGN_TO_FLEX[align];
}
