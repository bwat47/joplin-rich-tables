import { EditorView } from '@codemirror/view';
import { alphaEquivalentLayer, parseHexColor, toPercentageCss, toRgbCss } from './selectionOverlayColor';

/**
 * Joplin's editor text-selection colors, which no Joplin CSS variable exposes.
 *
 * Joplin only styles selection in dark mode (`packages/editor/CodeMirror/theme.ts`); in light
 * mode it leaves the selection unstyled and CodeMirror's own base theme colors apply.  The light
 * values below are therefore CodeMirror's defaults, restated here so both modes read from one
 * place.  `--joplin-selected-color` is deliberately not used: it is the list-item selection
 * color (light `#e5e5e5`, dark `#616161`), not the text-selection color.
 */
const JOPLIN_SELECTION_COLORS = {
    light: { focused: '#d7d4f0', blurred: '#d9d9d9' },
    dark: { focused: '#6b6b6b', blurred: '#444444' },
} as const;

/**
 * The ground a selected table's cells are painted with, beneath the selection overlay.
 *
 * Joplin's editor background is a runtime variable, and the overlay below can only be solved
 * against a background known ahead of time — so the plugin paints one rather than guessing.
 * These match Joplin's default light and dark editor backgrounds, but the pair is
 * self-consistent whatever a theme does: the ground is fully covered by the overlay, which is
 * derived from it, so the two always composite to the selection colour.
 */
const TABLE_SELECTION_GROUNDS = {
    light: '#ffffff',
    dark: '#1d2024',
} as const;

/**
 * Alpha applied to the multi-cell selection fill.
 */
const CELL_SELECTION_ALPHA = '60%';

/**
 * The tint that turns a selected table's painted ground into Joplin's selection colour.
 *
 * CodeMirror puts its selection background *behind* editor text; a rendered table has surfaces
 * it can never reach — the header's background, inline code, `==highlight==`, images, the cell
 * borders — so the plugin lays its own layer *over* the table instead.  Solving for the faintest
 * layer that reproduces the selection colour on the ground keeps that honest: everything at the
 * ground's tone lands exactly on the selection colour, while text of the opposite tone passes
 * through nearly untouched.  Painting the selection colour itself at some chosen alpha does
 * neither — it washes the text out and still leaves every opaque surface standing proud of the
 * fill.
 *
 * The colour and its alpha are published separately so consumers can lay the same tint over
 * whatever base they have; see `tableWidget/tableSelectionHighlight.ts`.
 */
function tintProperties(mode: keyof typeof JOPLIN_SELECTION_COLORS): Record<string, string> {
    const ground = parseHexColor(TABLE_SELECTION_GROUNDS[mode]);
    const tintFor = (target: string) => alphaEquivalentLayer(parseHexColor(target), ground);
    const focused = tintFor(JOPLIN_SELECTION_COLORS[mode].focused);
    const blurred = tintFor(JOPLIN_SELECTION_COLORS[mode].blurred);

    return {
        '--rt-tint-focused': toRgbCss(focused.color),
        '--rt-tint-focused-alpha': toPercentageCss(focused.alpha),
        '--rt-tint-blurred': toRgbCss(blurred.color),
        '--rt-tint-blurred-alpha': toPercentageCss(blurred.alpha),
    };
}

/**
 * Fades a color toward transparent.
 */
const withAlpha = (color: string, alpha: string): string => `color-mix(in srgb, ${color} ${alpha}, transparent)`;

/**
 * Maps Joplin theme variables to plugin-owned --rt-* custom properties.
 *
 * Defined on the main editor root so all plugin DOM (widget, nested editor, toolbar)
 * inherits them via CSS cascade.  Updating a Joplin variable name means changing
 * one line here rather than hunting across multiple style files.
 *
 * --rt-border-color        borders, outlines, dividers
 * --rt-cell-selection-bg   multi-cell selection background (painted on the cell, behind its text)
 * --rt-selection-focused-bg  Joplin's selection background while the editor owning it has focus.
 *                          Painted by the nested editor's drawSelection layer, and as the fill
 *                          behind a rendered table the main editor's selection covers.
 * --rt-selection-blurred-bg  the same fill while that editor is unfocused
 * --rt-table-selection-ground-bg  opaque ground painted on a selected table's cells
 * --rt-tint-focused        colour of the layer laid over a selected table, which composites with
 *                          that ground to --rt-selection-focused-bg
 * --rt-tint-focused-alpha  the alpha that layer is laid on at, as a percentage
 * --rt-tint-blurred, --rt-tint-blurred-alpha  the same pair for --rt-selection-blurred-bg
 * --rt-code-bg             inline code background
 * --rt-code-color          inline code text
 * --rt-mark-bg             ==highlight== background
 * --rt-mark-color          ==highlight== text
 * --rt-link-color          anchor text
 * --rt-header-bg           <th> background
 * --rt-toolbar-bg          floating toolbar background
 * --rt-toolbar-color       floating toolbar text
 * --rt-toolbar-shadow      floating toolbar box-shadow color (deliberately not theme-derived:
 *                          a shadow is light occlusion, so it stays dark in every theme.  Joplin's
 *                          background-color-transparent2 is an overlay scrim that inverts to white
 *                          on dark themes, which reads as a glow rather than a shadow.)
 * --rt-toolbar-hover-bg    toolbar button hover background
 *
 * The `&light`/`&dark` blocks resolve to CodeMirror's own light/dark theme classes on the editor
 * root, so they follow the `EditorView.darkTheme` facet.  They must stay after the `&` block:
 * all three selectors are a single class, so source order decides the winner.  Any editor whose
 * DOM these variables must resolve on has to report the same facet value as the host editor —
 * see the `dark` option passed in `nestedEditor/nestedEditorTheme.ts`.
 */
export const richTableThemeVars = EditorView.baseTheme({
    '&': {
        '--rt-border-color': 'var(--joplin-divider-color, #dddddd)',
        '--rt-code-bg': 'var(--joplin-code-background-color, rgb(243, 243, 243))',
        '--rt-code-color': 'var(--joplin-code-color, rgb(0, 0, 0))',
        '--rt-mark-bg': 'var(--joplin-mark-highlight-background-color, #F7D26E)',
        '--rt-mark-color': 'var(--joplin-mark-highlight-color, black)',
        '--rt-link-color': 'var(--joplin-url-color, #155BDA)',
        '--rt-header-bg': 'var(--joplin-table-background-color, rgb(247, 247, 247))',
        '--rt-toolbar-bg': 'var(--joplin-background-color)',
        '--rt-toolbar-color': 'var(--joplin-color)',
        '--rt-toolbar-shadow': 'rgba(0, 0, 0, 0.2)',
        '--rt-toolbar-hover-bg': 'var(--joplin-selected-color)',
    } as Record<string, string>,
    '&light': {
        '--rt-cell-selection-bg': withAlpha(JOPLIN_SELECTION_COLORS.light.focused, CELL_SELECTION_ALPHA),
        '--rt-selection-focused-bg': JOPLIN_SELECTION_COLORS.light.focused,
        '--rt-selection-blurred-bg': JOPLIN_SELECTION_COLORS.light.blurred,
        '--rt-table-selection-ground-bg': TABLE_SELECTION_GROUNDS.light,
        ...tintProperties('light'),
    } as Record<string, string>,
    '&dark': {
        '--rt-cell-selection-bg': withAlpha(JOPLIN_SELECTION_COLORS.dark.focused, CELL_SELECTION_ALPHA),
        '--rt-selection-focused-bg': JOPLIN_SELECTION_COLORS.dark.focused,
        '--rt-selection-blurred-bg': JOPLIN_SELECTION_COLORS.dark.blurred,
        '--rt-table-selection-ground-bg': TABLE_SELECTION_GROUNDS.dark,
        ...tintProperties('dark'),
    } as Record<string, string>,
});
