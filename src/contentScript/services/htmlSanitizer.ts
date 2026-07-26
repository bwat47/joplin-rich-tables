import DOMPurify from 'dompurify';

const IFRAME_TAG = 'iframe';

const YOUTUBE_EMBED_ALLOWED_HOSTS = new Set<string>([
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
    'www.youtube.com',
    'youtube.com',
]);

const YOUTUBE_EMBED_PATH_REGEX = /^\/embed\/[A-Za-z0-9_-]{11}$/;

function isAllowedYouTubeEmbedSrc(src: string): boolean {
    try {
        const url = new URL(src, 'https://invalid.example');
        if (url.protocol !== 'https:') {
            return false;
        }

        if (!YOUTUBE_EMBED_ALLOWED_HOSTS.has(url.hostname)) {
            return false;
        }

        return YOUTUBE_EMBED_PATH_REGEX.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * Configure DOMPurify hooks once globally to avoid re-adding them on every render.
 *
 * Deliberately registered at module load: the hook enforces the iframe
 * allowlist, so it must be in place before any caller can reach
 * DOMPurify.sanitize. Deferring it behind an init function would make the
 * security property depend on every call site remembering to trigger it.
 */
// eslint-disable-next-line unicorn/no-top-level-side-effects
DOMPurify.addHook('afterSanitizeElements', (node) => {
    // Only allow trusted YouTube embed iframes; remove everything else.
    if (!(node instanceof Element && node.tagName === 'IFRAME')) {
        return;
    }

    const src = node.getAttribute('src');
    if (!src || !isAllowedYouTubeEmbedSrc(src)) {
        node.remove();
    }
});

/**
 * Sanitize HTML rendered by Joplin to ensure security and fix display issues.
 * - Allows specific attributes needed for internal links/images/videos
 * - Allows unknown protocols for joplin-content://
 * - Relies on DOMPurify's safe defaults to block dangerous tags/attributes
 */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ALLOW_UNKNOWN_PROTOCOLS: true,
        ADD_TAGS: [IFRAME_TAG],
        ADD_ATTR: [
            'data-resource-id',
            'data-note-id',
            'data-item-id',
            'data-from-md',
            'src',
            'title',
            'frameborder',
            'allowfullscreen',
            'allow',
            'loading',
            'referrerpolicy',
        ],
        FORBID_ATTR: ['srcdoc'],
    });
}
