/**
 * Tiny LRU cache for last-measured table widget heights.
 *
 * Purpose: Provide better `WidgetType.estimatedHeight` values so CodeMirror
 * can stabilize scrolling when large block widgets are mounted/rebuilt.
 */

const MAX_ENTRIES = 200;

function hashTableText(text: string): string {
    // FNV-1a 32-bit (fast, deterministic, good enough for cache keys)
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    // Include length to reduce accidental collisions in practice.
    return `${(hash >>> 0).toString(16)}:${text.length}`;
}

class TableHeightCache {
    private readonly cache = new Map<string, number>();

    private getTextKey(tableText: string): string {
        return `text:${hashTableText(tableText)}`;
    }

    private getFromKey(tableFrom: number): string {
        return `from:${tableFrom}`;
    }

    public getMeasureKey(tableFrom: number, tableText: string): string {
        // Prefer a stable per-table key for requestMeasure deduping.
        return `${this.getFromKey(tableFrom)}|${this.getTextKey(tableText)}`;
    }

    private getByKey(key: string): number | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Refresh recency.
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    public get(params: { tableFrom: number; tableText: string }): number | undefined {
        // During in-table edits, `tableText` changes but `tableFrom` usually doesn't.
        // During edits above the table, `tableFrom` changes but `tableText` doesn't.
        // Checking both makes the cache useful in both situations.
        return this.getByKey(this.getFromKey(params.tableFrom)) ?? this.getByKey(this.getTextKey(params.tableText));
    }

    public set(params: { tableFrom: number; tableText: string; heightPx: number }): void {
        const { tableFrom, tableText, heightPx } = params;
        if (!Number.isFinite(heightPx) || heightPx <= 0) {
            return;
        }

        const keys = [this.getFromKey(tableFrom), this.getTextKey(tableText)];
        for (const key of keys) {
            // Refresh recency.
            if (this.cache.has(key)) {
                this.cache.delete(key);
            } else if (this.cache.size >= MAX_ENTRIES) {
                const firstKey = this.cache.keys().next().value as string | undefined;
                if (firstKey !== undefined) {
                    this.cache.delete(firstKey);
                }
            }

            this.cache.set(key, heightPx);
        }
    }

    public clear(): void {
        this.cache.clear();
    }
}

export const tableHeightCache = new TableHeightCache();
