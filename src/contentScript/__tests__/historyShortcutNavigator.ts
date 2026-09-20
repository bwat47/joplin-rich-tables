export type SimulatedPlatform = 'macOS' | 'Windows' | 'Linux';

const PLATFORM_NAVIGATOR: Record<SimulatedPlatform, { platform: string; userAgent: string; vendor: string }> = {
    macOS: {
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        vendor: 'Google Inc.',
    },
    Windows: {
        platform: 'Win32',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        vendor: 'Google Inc.',
    },
    Linux: {
        platform: 'Linux x86_64',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        vendor: 'Google Inc.',
    },
};

/** Mutates `navigator` before `@codemirror/view` is imported. */
export function stubHistoryShortcutNavigator(platform: SimulatedPlatform): void {
    const spec = PLATFORM_NAVIGATOR[platform];
    Object.defineProperty(navigator, 'platform', { configurable: true, value: spec.platform });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: spec.userAgent });
    Object.defineProperty(navigator, 'vendor', { configurable: true, value: spec.vendor });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
}
