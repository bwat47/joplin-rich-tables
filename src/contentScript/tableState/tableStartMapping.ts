import { MapMode, type ChangeDesc } from '@codemirror/state';

/**
 * Rejects anchors outside the pre-change document, where `mapPos` would throw.
 * `Number.isFinite` is load-bearing: both range comparisons evaluate false for NaN.
 */
function isAnchorInBounds(pos: number, changes: ChangeDesc): boolean {
    return Number.isFinite(pos) && pos >= 0 && pos <= changes.length;
}

/**
 * Maps a table-start anchor through document changes, keeping it when the table's
 * first character is deleted (the anchor lands at the deletion point).
 *
 * Returns `null` only when the anchor is outside the pre-change document.
 */
export function mapTableStartThroughChanges(tableFrom: number, changes: ChangeDesc): number | null {
    return isAnchorInBounds(tableFrom, changes) ? changes.mapPos(tableFrom, 1) : null;
}

/**
 * Maps a table-end anchor through document changes, keeping it when the table's
 * last character is deleted (the anchor lands at the deletion point).
 *
 * Returns `null` only when the anchor is outside the pre-change document.
 */
function mapTableEndThroughChanges(tableTo: number, changes: ChangeDesc): number | null {
    return isAnchorInBounds(tableTo, changes) ? changes.mapPos(tableTo, -1) : null;
}

/**
 * Maps a table's inclusive `[from, to]` span through document changes.
 *
 * Start uses assoc 1 and end uses assoc -1 so insertions at either edge stay
 * outside the table.
 *
 * Returns `null` when either edge is outside the pre-change document.
 */
export function mapTableSpanThroughChanges(
    span: { from: number; to: number },
    changes: ChangeDesc
): { from: number; to: number } | null {
    const from = mapTableStartThroughChanges(span.from, changes);
    const to = mapTableEndThroughChanges(span.to, changes);
    return from === null || to === null ? null : { from, to };
}

/**
 * Maps a table-start anchor through document changes, dropping it when the table's
 * identity is lost.
 *
 * The anchor sits immediately before the table's first character. Insertions at the
 * anchor stay before the table and move the anchor forward.
 *
 * Returns `null` when the anchor is outside the pre-change document, or when the
 * table's first character is deleted (`MapMode.TrackAfter`), since an anchor inside
 * a deleted range would otherwise survive at the deletion point and point at whatever
 * text replaced the table.
 */
export function mapTableStartUnlessDeleted(tableFrom: number, changes: ChangeDesc): number | null {
    return isAnchorInBounds(tableFrom, changes) ? changes.mapPos(tableFrom, 1, MapMode.TrackAfter) : null;
}
