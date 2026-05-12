import { Facet } from '@codemirror/state';
import { logger } from '../../logger';
import type { LinkOpener } from './joplinBridge';

const fallbackLinkOpener: LinkOpener = {
    open(href) {
        logger.warn('Link opener service missing, cannot open link', href);
    },
};

export const linkOpenerFacet = Facet.define<LinkOpener, LinkOpener>({
    combine: (values) => values[0] ?? fallbackLinkOpener,
});

export type { LinkOpener };
