/** An opaque sRGB colour. */
export interface Rgb {
    r: number;
    g: number;
    b: number;
}

/** A translucent layer: an opaque colour and the alpha it is painted at. */
export interface AlphaLayer {
    color: Rgb;
    alpha: number;
}

const CHANNEL_MAX = 255;
const HEX_COLOR_PATTERN = /^#([0-9a-f]{6})$/i;
/** Alpha is rounded up at this precision so no channel is pushed back out of range. */
const ALPHA_PRECISION = 10_000;

/**
 * Parses a `#rrggbb` colour.
 *
 * @throws RangeError when the string is not a six-digit hex colour.
 */
export function parseHexColor(hex: string): Rgb {
    const match = HEX_COLOR_PATTERN.exec(hex.trim());
    if (!match) {
        throw new RangeError(`Expected a #rrggbb colour, received "${hex}"`);
    }

    const value = Number.parseInt(match[1], 16);

    // Unpack the packed 24-bit colour.
    return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

const channelsOf = (color: Rgb): readonly number[] => [color.r, color.g, color.b];

/**
 * The smallest alpha at which some opaque colour, painted over `ground`, can produce `target`.
 *
 * Painting a layer of colour `c` at alpha `a` yields `a·c + (1 - a)·ground`, so reaching a
 * target channel needs `c = (target - (1 - a)·ground) / a`.  That has a solution only while `c`
 * stays inside `[0, 255]`: darkening a channel needs at least `(ground - target) / ground`, and
 * lightening one at least `(target - ground) / (255 - ground)`.  The channel demanding the most
 * decides the layer, and every smaller alpha is unreachable.
 */
function minimumAlpha(target: Rgb, ground: Rgb): number {
    let alpha = 0;

    channelsOf(target).forEach((targetChannel, index) => {
        const groundChannel = channelsOf(ground)[index];
        const darkening = targetChannel <= groundChannel;
        const headroom = darkening ? groundChannel : CHANNEL_MAX - groundChannel;
        if (headroom === 0) {
            return;
        }

        alpha = Math.max(alpha, Math.abs(targetChannel - groundChannel) / headroom);
    });

    return Math.ceil(alpha * ALPHA_PRECISION) / ALPHA_PRECISION;
}

const clampChannel = (value: number): number => Math.min(CHANNEL_MAX, Math.max(0, Math.round(value)));

/**
 * The translucent layer that turns `ground` into `target` when painted over it.
 *
 * A layer picked this way is the faintest one that still reproduces the target exactly, which is
 * what makes it usable on top of content: to lighten a ground it comes out near-white, to darken
 * one near-black, so it barely disturbs text of the opposite tone while every surface at the
 * ground's own tone lands squarely on the target colour.
 */
export function alphaEquivalentLayer(target: Rgb, ground: Rgb): AlphaLayer {
    const alpha = minimumAlpha(target, ground);
    if (alpha === 0) {
        // The ground already is the target, so any colour at zero alpha describes it.
        return { color: target, alpha: 0 };
    }

    const solveChannel = (targetChannel: number, groundChannel: number): number =>
        clampChannel((targetChannel - (1 - alpha) * groundChannel) / alpha);

    return {
        color: {
            r: solveChannel(target.r, ground.r),
            g: solveChannel(target.g, ground.g),
            b: solveChannel(target.b, ground.b),
        },
        alpha,
    };
}

/** Renders a layer as a CSS `rgba()` colour. */
export function toCssColor(layer: AlphaLayer): string {
    const { color, alpha } = layer;
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}
