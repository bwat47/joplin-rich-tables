import { MapMode, type ChangeDesc } from '@codemirror/state';

/**
 * Rejects anchors outside the pre-change document, where `mapPos` would throw.
 * `Number.isFinite` is load-bearing: both range comparisons evaluate false for NaN.
 */
function isAnchorInBounds(tableFrom: number, changes: ChangeDesc): boolean {
    return Number.isFinite(tableFrom) && tableFrom >= 0 && tableFrom <= changes.length;
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
