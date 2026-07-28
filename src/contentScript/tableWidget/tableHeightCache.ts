/**
 * Tiny LRU cache for last-measured table widget heights.
 *
 * Purpose: Provide better `WidgetType.estimatedHeight` values so CodeMirror
 * can stabilize scrolling when large block widgets are mounted/rebuilt.
 */

/** Per-index capacity: each index holds up to this many tables. */
export const MAX_ENTRIES = 200;

/**
 * Bounded map with least-recently-used eviction.
 *
 * Insertion order is recency order: `get` and `set` both move a key to the end,
 * so the oldest key is always the first one `keys()` yields.
 */
class LruMap<K, V> {
    private readonly entries = new Map<K, V>();

    constructor(private readonly maxEntries: number) {}

    public get(key: K): V | undefined {
        const value = this.entries.get(key);
        if (value === undefined) {
            return undefined;
        }
        // Refresh recency.
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    public set(key: K, value: V): void {
        // A key already present is being refreshed, not added, so it needs no eviction.
        if (!this.entries.delete(key) && this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next().value as K | undefined;
            if (oldest !== undefined) {
                this.entries.delete(oldest);
            }
        }
        this.entries.set(key, value);
    }

    public clear(): void {
        this.entries.clear();
    }
}

class TableHeightCache {
    // Two independent indexes over the same measurements. Sharing one budget would
    // halve the effective capacity, since every measurement writes to both, and would
    // let a table's two entries evict each other.
    private readonly byText = new LruMap<string, number>(MAX_ENTRIES);
    private readonly byPosition = new LruMap<number, number>(MAX_ENTRIES);

    public getMeasureKey(tableFrom: number, tableText: string): string {
        // Prefer a stable per-table key for requestMeasure deduping.
        return `from:${tableFrom}|text:${tableText}`;
    }

    public get(params: { tableFrom: number; tableText: string }): number | undefined {
        // During in-table edits, `tableText` changes but `tableFrom` usually doesn't.
        // During edits above the table, `tableFrom` changes but `tableText` doesn't.
        // Checking both makes the cache useful in both situations.
        return this.byPosition.get(params.tableFrom) ?? this.byText.get(params.tableText);
    }

    public set(params: { tableFrom: number; tableText: string; heightPx: number }): void {
        const { tableFrom, tableText, heightPx } = params;
        if (!Number.isFinite(heightPx) || heightPx <= 0) {
            return;
        }

        this.byText.set(tableText, heightPx);
        this.byPosition.set(tableFrom, heightPx);
    }

    public clear(): void {
        this.byText.clear();
        this.byPosition.clear();
    }
}

export const tableHeightCache = new TableHeightCache();
