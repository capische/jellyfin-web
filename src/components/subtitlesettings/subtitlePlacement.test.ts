import { describe, expect, it } from 'vitest';

import {
    SubtitlePosition,
    getBandLayout,
    getFlexAlign,
    getLayerRoles,
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

describe('getLayerRoles', () => {
    it('stacks the secondary when both sit in the same band with the same alignment', () => {
        expect(getLayerRoles(SubtitlePosition.Bottom, SubtitlePosition.Bottom)).toEqual({
            primary: 'edge',
            secondary: 'stacked'
        });
    });

    it('gives both an edge offset when they are in different bands', () => {
        expect(getLayerRoles(SubtitlePosition.Bottom, SubtitlePosition.Top)).toEqual({
            primary: 'edge',
            secondary: 'edge'
        });
    });

    it('gives both an edge offset when they share a line', () => {
        expect(getLayerRoles(SubtitlePosition.BottomLeft, SubtitlePosition.BottomRight)).toEqual({
            primary: 'edge',
            secondary: 'edge'
        });
    });

    it('does not stack when there is no secondary subtitle', () => {
        expect(getLayerRoles(SubtitlePosition.Bottom, SubtitlePosition.Bottom, false)).toEqual({
            primary: 'edge',
            secondary: 'edge'
        });
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

    it('resets a secondary offset, since the value now means a gap', () => {
        // -6 was the secondary default, an absolute position with no gap equivalent.
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
