import { CELL_BORDER_WIDTH } from './tableStyles';

/** Builds the selector for a set of selected cells, optionally suffixed with a pseudo-element. */
export type SelectedCellSelector = (pseudo?: string) => string;

/**
 * Lays the selection tint over `base`.
 *
 * `--rt-tint`/`--rt-tint-alpha` describe one layer, already resolved for the editor's focus state
 * (see `richTableThemeVars.ts`), and `color-mix` composites it over whatever it is given: over
 * transparency it is the layer itself, over an opaque colour it is what that colour looks like
 * beneath the layer. That second form is how surfaces the overlay cannot physically cover still
 * get tinted with it.
 */
const tinted = (base: string): string => `color-mix(in srgb, var(--rt-tint) var(--rt-tint-alpha), ${base})`;

/**
 * Theme rules painting cells as selected, in Joplin's selection colour.
 *
 * Shared by the two selections a rendered table can be under — the main editor's, covering the
 * whole table, and the widget's own multi-cell rectangle — so the two read as one idea.
 *
 * A cell takes the ground the tint is solved against, replacing whatever background it had, and
 * an overlay composites that ground up to the selection colour, taking everything the cell
 * renders with it. CodeMirror's own selection background could not: it sits behind editor text,
 * where a table carries opaque backgrounds of its own on the header, inline code, `==highlight==`
 * and images. Painting the ground rather than inheriting the theme's is what lets the tint be
 * exact (see `selectionOverlayColor.ts`).
 *
 * Cell borders are tinted through their colour instead, because they sit outside the padding box
 * the overlay covers and `border-collapse` has made each inner one shared, so an overlay grown to
 * reach them would darken those twice. Left untinted they all but vanish — the divider colour is
 * a light grey chosen to read on the editor background, and the selection ground is darker than
 * it, dropping a gridline's contrast against its own cell from about 1.36 to 1.06.
 *
 * A shared gridline can only take one colour, and where a selection ends mid-table the two cells
 * meeting across it disagree. CSS settles that in favour of the cell further up and left, so a
 * selection's top and left edges are drawn by their *unselected* neighbours, in the untinted
 * colour — the two sides of a rectangle that come out faint while the other two look right. The
 * overlay redraws those two sides itself, from inside the cell where no conflict can arise. It
 * paints the same opaque tinted colour the border already carries, so on the edges the border
 * won there is nothing to see.
 */
export function selectedCellRules(cells: SelectedCellSelector): Record<string, Record<string, string>> {
    return {
        [cells()]: {
            backgroundColor: 'var(--rt-selection-ground-bg)',
            borderColor: tinted('var(--rt-border-color)'),
        },
        [cells('::after')]: {
            content: '""',
            position: 'absolute',
            inset: '0',
            // Above content the cell positions for itself, which would otherwise paint over the fill.
            zIndex: '1',
            backgroundColor: tinted('transparent'),
            // One shadow offset diagonally, so the corner between the two sides is covered too.
            boxShadow: `-${CELL_BORDER_WIDTH} -${CELL_BORDER_WIDTH} 0 ${tinted('var(--rt-border-color)')}`,
            pointerEvents: 'none',
        },
    };
}
