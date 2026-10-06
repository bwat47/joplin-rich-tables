import { clamp } from '../shared/numberUtils';
import { localToRootOffsets, rootToLocalOffsets } from './cellTextNormalization';

export interface CellTextSelection {
    anchor: number;
    head: number;
}

/**
 * Reads both endpoints out of an offset map built once for the whole cell.
 *
 * Each endpoint is mapped on its own, so a backward selection stays backward, and every value
 * the map holds is a real offset in the text it maps into - the map never needs the text it
 * measures to be altered first, so there is nothing to clamp away afterwards.
 */
function mapSelection(selection: CellTextSelection, offsets: Int32Array): CellTextSelection {
    const lastOffset = offsets.length - 1;
    return {
        anchor: offsets[clamp(selection.anchor, 0, lastOffset)],
        head: offsets[clamp(selection.head, 0, lastOffset)],
    };
}

export function toRootSelection(localSelection: CellTextSelection, localText: string): CellTextSelection {
    return mapSelection(localSelection, localToRootOffsets(localText));
}

export function toLocalSelection(rootSelection: CellTextSelection, rootText: string): CellTextSelection {
    return mapSelection(rootSelection, rootToLocalOffsets(rootText));
}
