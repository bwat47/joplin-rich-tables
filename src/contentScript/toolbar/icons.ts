const createSvg = (doc: Document, paths: Array<{ d: string; fill?: string; stroke?: string }>) => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('cm-table-toolbar-icon');

    for (const pathSpec of paths) {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathSpec.d);
        if (pathSpec.fill) path.setAttribute('fill', pathSpec.fill);
        if (pathSpec.stroke) path.setAttribute('stroke', pathSpec.stroke);
        svg.appendChild(path);
    }

    return svg;
};

// Tabler icons
export const rowInsertTopIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z' },
        { d: 'M12 9v-4' },
        { d: 'M10 7l4 0' },
    ]);

export const rowInsertBottomIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z' },
        { d: 'M12 15l0 4' },
        { d: 'M14 17l-4 0' },
    ]);

export const rowRemoveIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z' },
        { d: 'M10 16l4 4' },
        { d: 'M10 20l4 -4' },
    ]);

export const columnInsertLeftIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M5 12l4 0' },
        { d: 'M7 10l0 4' },
    ]);

export const columnInsertRightIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M15 12l4 0' },
        { d: 'M17 10l0 4' },
    ]);

export const columnRemoveIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M16 10l4 4' },
        { d: 'M16 14l4 -4' },
    ]);

export const alignLeftIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M4 12l10 0' },
        { d: 'M4 18l14 0' },
    ]);

export const alignCenterIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M8 12l8 0' },
        { d: 'M6 18l12 0' },
    ]);

export const alignRightIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M10 12l10 0' },
        { d: 'M6 18l14 0' },
    ]);

export const moveColumnLeftIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M5 12l14 0' },
        { d: 'M5 12l4 4' },
        { d: 'M5 12l4 -4' },
    ]);

export const moveColumnRightIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M5 12l14 0' },
        { d: 'M15 16l4 -4' },
        { d: 'M15 8l4 4' },
    ]);

export const moveRowUpIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M12 5l0 14' },
        { d: 'M16 9l-4 -4' },
        { d: 'M8 9l4 -4' },
    ]);

export const moveRowDownIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M12 5l0 14' },
        { d: 'M16 15l-4 4' },
        { d: 'M8 15l4 4' },
    ]);

export const clearTableIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        {
            d: 'M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3',
        },
        { d: 'M18 13.3l-6.3 -6.3' },
    ]);

export const deleteTableIcon = (doc: Document) =>
    createSvg(doc, [
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        {
            d: 'M20 6a1 1 0 0 1 .117 1.993l-.117 .007h-.081l-.919 11a3 3 0 0 1 -2.824 2.995l-.176 .005h-8c-1.598 0 -2.904 -1.249 -2.992 -2.75l-.005 -.167l-.923 -11.083h-.08a1 1 0 0 1 -.117 -1.993l.117 -.007h16zm-9.489 5.14a1 1 0 0 0 -1.218 1.567l1.292 1.293l-1.292 1.293l-.083 .094a1 1 0 0 0 1.497 1.32l1.293 -1.292l1.293 1.292l.094 .083a1 1 0 0 0 1.32 -1.497l-1.292 -1.293l1.292 -1.293l.083 -.094a1 1 0 0 0 -1.497 -1.32l-1.293 1.292l-1.293 -1.292l-.094 -.083z',
            fill: 'currentColor',
            stroke: 'none',
        },
        {
            d: 'M14 2a2 2 0 0 1 2 2a1 1 0 0 1 -1.993 .117l-.007 -.117h-4l-.007 .117a1 1 0 0 1 -1.993 -.117a2 2 0 0 1 1.85 -1.995l.15 -.005h4z',
            fill: 'currentColor',
            stroke: 'none',
        },
    ]);
