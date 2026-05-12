import { Facet } from '@codemirror/state';
import { logger } from '../../logger';

export interface LinkOpener {
    open(href: string): void;
}

export function createLinkOpener(openLink: (href: string) => Promise<void>): LinkOpener {
    return {
        open(href) {
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
