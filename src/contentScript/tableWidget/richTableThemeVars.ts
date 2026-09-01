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
const SELECTION_GROUNDS = {
    light: '#ffffff',
    dark: '#1d2024',
} as const;

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
 * whatever base they have; see `tableWidget/wholeTableSelectionVisuals.ts`.
 */
function tintProperties(mode: keyof typeof JOPLIN_SELECTION_COLORS): Record<string, string> {
    const ground = parseHexColor(SELECTION_GROUNDS[mode]);
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
 * Maps Joplin theme variables to plugin-owned --rt-* custom properties.
 *
 * Defined on the main editor root so all plugin DOM (widget, nested editor, toolbar)
 * inherits them via CSS cascade.  Updating a Joplin variable name means changing
 * one line here rather than hunting across multiple style files.
 *
 * --rt-border-color        borders, outlines, dividers
 * --rt-selection-bg        the selection fill below, resolved for the editor's current focus state
 * --rt-tint, --rt-tint-alpha  the tint pair below, likewise resolved.  Resolving focus once here
 *                          keeps the fill and the tint from ever disagreeing about it, and spares
 *                          every rule that reads them a focused copy of itself.
 * --rt-selection-focused-bg  Joplin's selection background while the editor owning it has focus.
 *                          Painted by the nested editor's drawSelection layer, and as the fill
 *                          behind a rendered table the main editor's selection covers.
 * --rt-selection-blurred-bg  the same fill while that editor is unfocused
 * --rt-selection-ground-bg  opaque ground painted on a selected cell, beneath the tint
 * --rt-tint-focused        colour of the layer laid over a selected cell, which composites with
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
 * --rt-toolbar-shadow-near floating toolbar's compact shadow-layer color
 * --rt-toolbar-shadow-far  floating toolbar's diffuse shadow-layer color.  Both shadow colors are
 *                          deliberately not theme-derived: a shadow is light occlusion, so it stays
 *                          dark in every theme.  Joplin's background-color-transparent2 is an
 *                          overlay scrim that inverts to white on dark themes, which reads as a glow
 *                          rather than a shadow.
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
        '--rt-toolbar-shadow-near': 'rgba(0, 0, 0, 0.07)',
        '--rt-toolbar-shadow-far': 'rgba(0, 0, 0, 0.1)',
        '--rt-toolbar-hover-bg': 'var(--joplin-selected-color)',
        '--rt-selection-bg': 'var(--rt-selection-blurred-bg)',
        '--rt-tint': 'var(--rt-tint-blurred)',
        '--rt-tint-alpha': 'var(--rt-tint-blurred-alpha)',
    } as Record<string, string>,
    // `:focus-within` rather than `.cm-focused`, which tracks only this editor's own content:
    // a nested cell editor holds focus on the plugin's behalf, most visibly through a cell drag,
    // which keeps its anchor cell open for the length of the gesture.  Two components to the
    // block above's one, so focus wins wherever this sits in source order.
    '&:focus-within': {
        '--rt-selection-bg': 'var(--rt-selection-focused-bg)',
        '--rt-tint': 'var(--rt-tint-focused)',
        '--rt-tint-alpha': 'var(--rt-tint-focused-alpha)',
    } as Record<string, string>,
    '&light': {
        '--rt-selection-focused-bg': JOPLIN_SELECTION_COLORS.light.focused,
        '--rt-selection-blurred-bg': JOPLIN_SELECTION_COLORS.light.blurred,
        '--rt-selection-ground-bg': SELECTION_GROUNDS.light,
        ...tintProperties('light'),
    } as Record<string, string>,
    '&dark': {
        '--rt-selection-focused-bg': JOPLIN_SELECTION_COLORS.dark.focused,
        '--rt-selection-blurred-bg': JOPLIN_SELECTION_COLORS.dark.blurred,
        '--rt-selection-ground-bg': SELECTION_GROUNDS.dark,
        ...tintProperties('dark'),
    } as Record<string, string>,
});
