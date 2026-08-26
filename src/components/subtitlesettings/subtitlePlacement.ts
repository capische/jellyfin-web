/**
 * Subtitle placement resolution.
 *
 * A placement is the corner a subtitle profile occupies. It resolves to a band (the
 * horizontal strip it lives in) and an alignment within that band. Layers sharing a band are
 * laid out as flex siblings, so they can never overlap; the only question is whether they
 * stack (column) or sit next to each other (row).
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
 * The role a layer plays within its band, which decides how its vertical position value is
 * read: the edge-most layer measures from the screen edge, a stacked layer measures the gap
 * to the layer below it.
 */
export type LayerRole = 'edge' | 'stacked';

export interface LayerRoles {
    primary: LayerRole;
    secondary: LayerRole;
}

/**
 * Assign roles to the two layers.
 *
 * The primary always owns the distance to the screen edge. The secondary is 'stacked' only
 * when it actually sits above the primary — sharing a band, in a column layout. Alone in its
 * band, or beside the primary in a row, it measures from the edge like the primary does.
 */
export function getLayerRoles(
    primaryPosition: string | undefined | null,
    secondaryPosition: string | undefined | null,
    hasSecondary = true
): LayerRoles {
    const primary = resolvePlacement(primaryPosition);
    const secondary = resolvePlacement(secondaryPosition);

    const stacked = hasSecondary
        && primary.band === secondary.band
        && getBandLayout(primary, secondary) === 'column';

    return {
        primary: 'edge',
        secondary: stacked ? 'stacked' : 'edge'
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
 * A secondary profile's old value was an absolute screen position, not a gap, so there is
 * nothing meaningful to carry over — it resets to `0` (flush above the primary) and the user
 * can open it back up.
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
