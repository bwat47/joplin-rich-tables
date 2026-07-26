import { Facet } from '@codemirror/state';
import { logger } from '../../logger';

export interface LinkOpener {
    open(href: string): void;
}

export function createLinkOpener(openLink: (href: string) => Promise<void>): LinkOpener {
    return {
        open(href) {
            // Fire-and-forget by design: `open` is declared void so DOM event
            // handlers can call it without awaiting. Making this async would
            // return a promise nobody consumes.
            // eslint-disable-next-line unicorn/prefer-await
            openLink(href).catch((error) => {
                logger.error('Failed to open link:', error);
            });
        },
    };
}

const fallbackLinkOpener: LinkOpener = {
    open(href) {
        logger.warn('Link opener service missing, cannot open link', href);
    },
};

export const linkOpenerFacet = Facet.define<LinkOpener, LinkOpener>({
    combine: (values) => values[0] ?? fallbackLinkOpener,
});
