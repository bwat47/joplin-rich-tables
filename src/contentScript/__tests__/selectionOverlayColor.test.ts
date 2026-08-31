import { describe, expect, it } from 'vitest';
import {
    alphaEquivalentLayer,
    parseHexColor,
    toPercentageCss,
    toRgbCss,
    type Rgb,
} from '../tableWidget/selectionOverlayColor';

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Composites a layer over a ground, the way a browser paints it. */
function composite(target: Rgb, ground: Rgb): Rgb {
    const { color, alpha } = alphaEquivalentLayer(target, ground);
    const blend = (layerChannel: number, groundChannel: number): number =>
        Math.round(alpha * layerChannel + (1 - alpha) * groundChannel);

    return {
        r: blend(color.r, ground.r),
        g: blend(color.g, ground.g),
        b: blend(color.b, ground.b),
    };
}

describe('parseHexColor', () => {
    it('unpacks a #rrggbb colour', () => {
        expect(parseHexColor('#d7d4f0')).toEqual({ r: 215, g: 212, b: 240 });
    });

    it('rejects anything that is not a six-digit hex colour', () => {
        expect(() => parseHexColor('#fff')).toThrow(RangeError);
        expect(() => parseHexColor('rgb(1 2 3)')).toThrow(RangeError);
    });
});

describe('alphaEquivalentLayer', () => {
    it('reproduces the target when composited back over the ground', () => {
        const cases: [Rgb, Rgb][] = [
            [parseHexColor('#d7d4f0'), WHITE],
            [parseHexColor('#d9d9d9'), WHITE],
            [parseHexColor('#6b6b6b'), parseHexColor('#1d2024')],
            [parseHexColor('#444444'), parseHexColor('#1d2024')],
        ];

        for (const [target, ground] of cases) {
            expect(composite(target, ground)).toEqual(target);
        }
    });

    it('stays faint enough to leave text of the opposite tone legible', () => {
        // Lightening a white ground to Joplin's light selection colour needs 17%; every channel
        // has to travel at most 40/255, so a heavier layer would only dim the text further.
        expect(alphaEquivalentLayer(parseHexColor('#d7d4f0'), WHITE).alpha).toBeCloseTo(0.169, 3);
    });

    it('comes out dark to darken a ground and light to lighten one', () => {
        expect(alphaEquivalentLayer(parseHexColor('#d7d4f0'), WHITE).color).toMatchObject({ r: 18, g: 0 });
        expect(alphaEquivalentLayer(parseHexColor('#6b6b6b'), parseHexColor('#1d2024')).color).toMatchObject({
            r: 255,
        });
    });

    it('describes a ground that already is the target as a fully transparent layer', () => {
        expect(alphaEquivalentLayer(WHITE, WHITE)).toEqual({ color: WHITE, alpha: 0 });
    });

    it('renders the colour and its alpha as separate CSS values', () => {
        expect(toRgbCss({ r: 18, g: 0, b: 166 })).toBe('rgb(18, 0, 166)');
        expect(toPercentageCss(0.1687)).toBe('16.87%');
        expect(toPercentageCss(0.15)).toBe('15%');
    });
});
