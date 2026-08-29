import { describe, expect, it } from 'vitest';

import {
    RESERVED_SECONDARY_LINES,
    SubtitlePosition,
    getBandLayout,
    getFlexAlign,
    getStackGeometry,
    isStacked,
    migratePlacement,
    resolvePlacement
} from './subtitlePlacement';

describe('resolvePlacement', () => {
    it('maps each position to a band and alignment', () => {
        expect(resolvePlacement(SubtitlePosition.Top)).toEqual({ band: 'top', align: 'center' });
        expect(resolvePlacement(SubtitlePosition.Bottom)).toEqual({ band: 'bottom', align: 'center' });
        expect(resolvePlacement(SubtitlePosition.BottomLeft)).toEqual({ band: 'bottom', align: 'start' });
        expect(resolvePlacement(SubtitlePosition.BottomRight)).toEqual({ band: 'bottom', align: 'end' });
    });

    it('falls back to bottom for missing or unknown values', () => {
        const fallback = { band: 'bottom', align: 'center' };
        expect(resolvePlacement(undefined)).toEqual(fallback);
        expect(resolvePlacement(null)).toEqual(fallback);
        expect(resolvePlacement('')).toEqual(fallback);
        expect(resolvePlacement('somewhere-else')).toEqual(fallback);
    });
});

describe('getBandLayout', () => {
    it('stacks layers that share an alignment', () => {
        const bottom = resolvePlacement(SubtitlePosition.Bottom);
        expect(getBandLayout(bottom, bottom)).toBe('column');
    });

    it('puts differently aligned layers on one line', () => {
        expect(getBandLayout(
            resolvePlacement(SubtitlePosition.BottomLeft),
            resolvePlacement(SubtitlePosition.BottomRight)
        )).toBe('row');
    });
});

describe('isStacked', () => {
    it('stacks when both sit in the same band with the same alignment', () => {
        expect(isStacked(SubtitlePosition.Bottom, SubtitlePosition.Bottom)).toBe(true);
    });

    it('does not stack layers in different bands', () => {
        expect(isStacked(SubtitlePosition.Bottom, SubtitlePosition.Top)).toBe(false);
    });

    it('does not stack layers sharing a line', () => {
        expect(isStacked(SubtitlePosition.BottomLeft, SubtitlePosition.BottomRight)).toBe(false);
    });

    it('does not stack when there is no secondary subtitle', () => {
        expect(isStacked(SubtitlePosition.Bottom, SubtitlePosition.Bottom, false)).toBe(false);
    });
});

describe('getStackGeometry', () => {
    const lineHeight = 20;
    const reserve = RESERVED_SECONDARY_LINES * lineHeight;

    it('reserves a fixed slot for the secondary whatever the offsets are', () => {
        expect(getStackGeometry(0, 0, lineHeight).secondaryReserve).toBe(reserve);
        expect(getStackGeometry(500, 120, lineHeight).secondaryReserve).toBe(reserve);
    });

    it('leaves the primary its own distance from the edge', () => {
        // The gap is measured from the top of the secondary's slot, so the primary still
        // ends up 300px from the edge.
        const { primaryGap } = getStackGeometry(300, 100, lineHeight);
        expect(primaryGap).toBe(300 - 100 - reserve);
        expect(100 + reserve + primaryGap).toBe(300);
    });

    it('pushes the primary clear when the reservation reaches into it', () => {
        const { primaryGap } = getStackGeometry(10, 0, lineHeight);
        expect(primaryGap).toBe(0);
        expect(0 + reserve + primaryGap).toBeGreaterThan(10);
    });

    it('does not depend on anything but the offsets, so cues cannot move a layer', () => {
        expect(getStackGeometry(80, 20, lineHeight)).toEqual(getStackGeometry(80, 20, lineHeight));
    });
});

describe('migratePlacement', () => {
    it('folds a negative vertical position into the bottom band', () => {
        // -3 was the primary default: bottom anchored, |pos + 1| = 2 lines of margin.
        expect(migratePlacement({ verticalPosition: -3 })).toEqual({
            position: SubtitlePosition.Bottom,
            verticalPosition: 2
        });
    });

    it('treats the bottom-most line as a zero offset', () => {
        expect(migratePlacement({ verticalPosition: -1 })).toEqual({
            position: SubtitlePosition.Bottom,
            verticalPosition: 0
        });
    });

    it('folds a positive vertical position into the top band', () => {
        expect(migratePlacement({ verticalPosition: 4 })).toEqual({
            position: SubtitlePosition.Top,
            verticalPosition: 4
        });
    });

    it('resets a secondary offset rather than carrying an absolute position over', () => {
        // -6 was the secondary default, back when it named a position on the screen.
        expect(migratePlacement({ verticalPosition: -6 }, true)).toEqual({
            position: SubtitlePosition.Bottom,
            verticalPosition: 0
        });
    });

    it('parses values stored as strings by the form controls', () => {
        expect(migratePlacement({ verticalPosition: '-3' })).toEqual({
            position: SubtitlePosition.Bottom,
            verticalPosition: 2
        });
    });

    it('leaves already-migrated settings alone', () => {
        expect(migratePlacement({ position: SubtitlePosition.Top, verticalPosition: 2 })).toEqual({
            position: SubtitlePosition.Top,
            verticalPosition: 2
        });
    });

    it('defaults when there is no vertical position to read', () => {
        expect(migratePlacement({})).toEqual({ position: SubtitlePosition.Bottom });
    });
});

describe('getFlexAlign', () => {
    it('maps alignments to flex values', () => {
        expect(getFlexAlign('start')).toBe('flex-start');
        expect(getFlexAlign('center')).toBe('center');
        expect(getFlexAlign('end')).toBe('flex-end');
    });
});
