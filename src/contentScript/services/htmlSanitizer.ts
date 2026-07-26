import DOMPurify from 'dompurify';

const IFRAME_TAG = 'iframe';

const YOUTUBE_EMBED_ALLOWED_HOSTS = new Set<string>([
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
    'www.youtube.com',
    'youtube.com',
]);

const YOUTUBE_EMBED_PATH_REGEX = /^\/embed\/[A-Za-z0-9_-]{11}$/;

let isYouTubeEmbedHookConfigured = false;

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
 */
function configureYouTubeEmbedHook(): void {
    if (isYouTubeEmbedHookConfigured) {
        return;
    }

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
    isYouTubeEmbedHookConfigured = true;
}

/**
 * Sanitize HTML rendered by Joplin to ensure security and fix display issues.
 * - Allows specific attributes needed for internal links/images/videos
 * - Allows unknown protocols for joplin-content://
 * - Relies on DOMPurify's safe defaults to block dangerous tags/attributes
 */
export function sanitizeHtml(html: string): string {
    configureYouTubeEmbedHook();

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
