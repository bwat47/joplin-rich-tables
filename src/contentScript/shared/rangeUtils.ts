/** True when `[fromA, toA]` overlaps or abuts inclusive `[from, to]`. Touching an endpoint counts. */
export function rangeTouchesInclusive(fromA: number, toA: number, from: number, to: number): boolean {
    return fromA <= to && toA >= from;
}
