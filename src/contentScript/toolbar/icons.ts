const createSvg = (paths: Array<{ d: string; fill?: string; stroke?: string }>) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
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
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathSpec.d);
        if (pathSpec.fill) path.setAttribute('fill', pathSpec.fill);
        if (pathSpec.stroke) path.setAttribute('stroke', pathSpec.stroke);
        svg.appendChild(path);
    }

    return svg;
};

// Tabler icons
export const rowInsertTopIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 18v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z' },
        { d: 'M12 9v-4' },
        { d: 'M10 7l4 0' },
    ]);

export const rowInsertBottomIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z' },
        { d: 'M12 15l0 4' },
        { d: 'M14 17l-4 0' },
    ]);

export const rowRemoveIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1z' },
        { d: 'M10 16l4 4' },
        { d: 'M10 20l4 -4' },
    ]);

export const columnInsertLeftIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M5 12l4 0' },
        { d: 'M7 10l0 4' },
    ]);

export const columnInsertRightIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M15 12l4 0' },
        { d: 'M17 10l0 4' },
    ]);

export const columnRemoveIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M6 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14a1 1 0 0 1 1 -1z' },
        { d: 'M16 10l4 4' },
        { d: 'M16 14l4 -4' },
    ]);

export const alignLeftIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M4 12l10 0' },
        { d: 'M4 18l14 0' },
    ]);

export const alignCenterIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M8 12l8 0' },
        { d: 'M6 18l12 0' },
    ]);

export const alignRightIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M4 6l16 0' },
        { d: 'M10 12l10 0' },
        { d: 'M6 18l14 0' },
    ]);

export const formatTableIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M3 21v-4a4 4 0 1 1 4 4h-4' },
        { d: 'M21 3a16 16 0 0 0 -12.8 10.2' },
        { d: 'M21 3a16 16 0 0 1 -10.2 12.8' },
        { d: 'M10.6 9a9 9 0 0 1 4.4 4.4' },
    ]);

export const moveColumnLeftIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M5 12l14 0' },
        { d: 'M5 12l4 4' },
        { d: 'M5 12l4 -4' },
    ]);

export const moveColumnRightIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M5 12l14 0' },
        { d: 'M15 16l4 -4' },
        { d: 'M15 8l4 4' },
    ]);

export const moveRowUpIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M12 5l0 14' },
        { d: 'M16 9l-4 -4' },
        { d: 'M8 9l4 -4' },
    ]);

export const moveRowDownIcon = () =>
    createSvg([
        { d: 'M0 0h24v24H0z', fill: 'none', stroke: 'none' },
        { d: 'M12 5l0 14' },
        { d: 'M16 15l-4 4' },
        { d: 'M8 15l4 4' },
    ]);
