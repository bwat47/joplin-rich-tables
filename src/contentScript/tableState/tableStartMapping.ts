import { MapMode, type ChangeDesc } from '@codemirror/state';

/**
 * Maps a table-start anchor through document changes.
 *
 * The anchor sits immediately before the table's first character, so deleting
 * that character invalidates the table identity. Insertions at the anchor stay
 * before the table and move the anchor forward.
 */
export function mapTableStartThroughChanges(tableFrom: number, changes: ChangeDesc): number | null {
    if (!Number.isFinite(tableFrom) || tableFrom < 0 || tableFrom > changes.length) {
        return null;
    }

    return changes.mapPos(tableFrom, 1, MapMode.TrackAfter);
}
