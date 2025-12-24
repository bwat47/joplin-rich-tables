import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { activeCellField, ActiveCell, clearActiveCellEffect } from '../tableWidget/activeCellState';
import {
    execInsertRowAbove,
    execInsertRowBelow,
    execInsertColumnLeft,
    execInsertColumnRight,
    execDeleteRow,
    execDeleteColumn,
    execUpdateAlignment,
    execFormatTable,
} from '../tableCommands/tableCommands';
import { computePosition, autoUpdate, offset, flip, shift, hide } from '@floating-ui/dom';
import { rebuildTableWidgetsEffect } from '../tableWidget/tableWidgetEffects';
import { CLASS_FLOATING_TOOLBAR, getWidgetSelector } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';

import {
    rowInsertTopIcon,
    rowInsertBottomIcon,
    rowRemoveIcon,
    columnInsertLeftIcon,
    columnInsertRightIcon,
    columnRemoveIcon,
    editMarkdownIcon,
    alignLeftIcon,
    alignCenterIcon,
    alignRightIcon,
    formatTableIcon,
} from './icons';

class TableToolbarPlugin {
    dom: HTMLElement;
    private currentActiveCell: ActiveCell | null = null;
    private cleanupAutoUpdate: (() => void) | null = null;

    constructor(private view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = CLASS_FLOATING_TOOLBAR;
        this.dom.style.position = 'absolute';
        this.dom.style.display = 'none';

        // Add buttons
        this.createButtons();

        view.dom.appendChild(this.dom);

        // Note: No scroll/resize event listeners - autoUpdate handles it
    }

    update(update: ViewUpdate) {
        const prevActiveCell = this.currentActiveCell;
        this.currentActiveCell = update.state.field(activeCellField);

        // Active cell state changed
        if (!!prevActiveCell !== !!this.currentActiveCell) {
            if (this.currentActiveCell) {
                // Defer to next frame to ensure widget DOM is ready
                requestAnimationFrame(() => this.updatePosition());
            } else {
                this.cleanupPositioning();
                // When the toolbar is no longer needed, remove it from layout entirely
                // to avoid any one-frame paint artifacts.
                this.hideToolbarCompletely();
            }
            return;
        }

        // Active cell changed to different table
        if (this.currentActiveCell && prevActiveCell && this.currentActiveCell.tableFrom !== prevActiveCell.tableFrom) {
            // Defer to next frame to ensure new table widget DOM is ready
            requestAnimationFrame(() => this.updatePosition());
            return;
        }

        // Table was modified (rows/columns added/removed) - reposition toolbar
        if (
            this.currentActiveCell &&
            update.transactions.some((tr) => tr.effects.some((e) => e.is(rebuildTableWidgetsEffect)))
        ) {
            // Defer to next frame to ensure rebuilt widget DOM is ready
            requestAnimationFrame(() => this.updatePosition());
        }

        // Note: autoUpdate handles other cases (scroll/resize)
    }

    destroy() {
        this.cleanupPositioning();
        this.dom.remove();
    }

    private createButtons() {
        const createIconBtn = (title: string, ariaLabel: string, svg: SVGSVGElement, onClick: () => void) => {
            const btn = document.createElement('button');
            btn.title = title;
            btn.className = 'cm-table-toolbar-btn';
            btn.type = 'button';
            btn.setAttribute('aria-label', ariaLabel);
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
                this.view.focus();
            };
            btn.appendChild(svg);
            this.dom.appendChild(btn);
            return btn;
        };

        // Row Operations
        createIconBtn('Insert row before', 'Insert row before', rowInsertTopIcon(), () => {
            if (this.currentActiveCell) {
                execInsertRowAbove(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Insert row after', 'Insert row after', rowInsertBottomIcon(), () => {
            if (this.currentActiveCell) {
                execInsertRowBelow(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Delete row', 'Delete row', rowRemoveIcon(), () => {
            if (this.currentActiveCell) {
                execDeleteRow(this.view, this.currentActiveCell);
            }
        });

        // Separator
        const createSeparator = () => {
            const sep = document.createElement('span');
            sep.className = 'cm-table-toolbar-separator';
            this.dom.appendChild(sep);
        };
        createSeparator();

        // Column Operations
        createIconBtn('Insert column before', 'Insert column before', columnInsertLeftIcon(), () => {
            if (this.currentActiveCell) {
                execInsertColumnLeft(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Insert column after', 'Insert column after', columnInsertRightIcon(), () => {
            if (this.currentActiveCell) {
                execInsertColumnRight(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Delete column', 'Delete column', columnRemoveIcon(), () => {
            if (this.currentActiveCell) {
                execDeleteColumn(this.view, this.currentActiveCell);
            }
        });

        createSeparator();

        // Alignment Operations
        createIconBtn('Align left', 'Align column left', alignLeftIcon(), () => {
            if (this.currentActiveCell) {
                execUpdateAlignment(this.view, this.currentActiveCell, 'left');
            }
        });
        createIconBtn('Align center', 'Align column center', alignCenterIcon(), () => {
            if (this.currentActiveCell) {
                execUpdateAlignment(this.view, this.currentActiveCell, 'center');
            }
        });
        createIconBtn('Align right', 'Align column right', alignRightIcon(), () => {
            if (this.currentActiveCell) {
                execUpdateAlignment(this.view, this.currentActiveCell, 'right');
            }
        });

        createSeparator();

        // Format table (re-serialize to normalize whitespace)
        createIconBtn('Format table', 'Format table', formatTableIcon(), () => {
            if (this.currentActiveCell) {
                execFormatTable(this.view, this.currentActiveCell);
            }
        });

        // Edit Mode
        createIconBtn('Edit table as markdown', 'Edit table as markdown', editMarkdownIcon(), () => {
            if (this.currentActiveCell) {
                this.view.dispatch({
                    selection: { anchor: this.currentActiveCell.tableFrom },
                    effects: [clearActiveCellEffect.of(undefined)],
                });
            }
        });
    }

    private showToolbar() {
        // Keep the element measurable for Floating UI.
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'visible';
    }

    private hideToolbar() {
        // We use display: none to ensure it is removed from the layout/paint immediately.
        // This prevents "ghosting" or lingering 1-frame artifacts.
        this.dom.style.display = 'none';
        this.dom.style.visibility = 'hidden';
    }

    private hideToolbarCompletely() {
        this.dom.style.visibility = 'hidden';
        this.dom.style.display = 'none';
    }

    private prepareToolbarForPositioning() {
        // Floating UI requires the element to be rendered (not display:none).
        // Start hidden to avoid flicker until we have a positioned x/y.
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'hidden';
        // Defensive: ensure a stable initial layout for measurement.
        if (!this.dom.style.left) this.dom.style.left = '0px';
        if (!this.dom.style.top) this.dom.style.top = '0px';
    }

    private cleanupPositioning() {
        if (this.cleanupAutoUpdate) {
            this.cleanupAutoUpdate();
            this.cleanupAutoUpdate = null;
        }
    }

    private updatePosition() {
        if (!this.currentActiveCell) {
            this.cleanupPositioning();
            this.hideToolbarCompletely();
            return;
        }

        const selector = getWidgetSelector(makeTableId(this.currentActiveCell.tableFrom));
        const referenceElement = this.view.contentDOM.querySelector(selector) as HTMLElement;

        if (!referenceElement) {
            this.cleanupPositioning();
            this.hideToolbarCompletely();
            return;
        }

        this.cleanupPositioning();
        this.prepareToolbarForPositioning();

        this.cleanupAutoUpdate = autoUpdate(
            referenceElement,
            this.dom,
            async () => {
                // Ensure element is measurable (display:flex) but hidden (visibility:hidden)
                // before asking Floating UI to compute position.
                this.prepareToolbarForPositioning();

                const currentRef = this.view.contentDOM.querySelector(selector) as HTMLElement;
                if (!currentRef) {
                    // Don't cleanup here - just hide and let the next update() call handle cleanup
                    this.hideToolbar();
                    return;
                }

                // First compute with preferred top placement
                let result = await computePosition(currentRef, this.dom, {
                    placement: 'top-start',
                    middleware: [
                        offset(5),
                        flip({ fallbackPlacements: ['bottom-start', 'top-start'] }),
                        shift({ padding: 5 }),
                        hide(),
                    ],
                });

                // Check if toolbar would be obscured near top of viewport (where Joplin's toolbar lives)
                const obscurationThreshold = 5; // Pixels from top of viewport
                if (result.y < obscurationThreshold) {
                    // Recompute with forced bottom placement
                    result = await computePosition(currentRef, this.dom, {
                        placement: 'bottom-start',
                        middleware: [offset(5), shift({ padding: 5 }), hide()],
                    });
                }

                if (result.middlewareData.hide?.referenceHidden) {
                    this.hideToolbar();
                    return;
                }

                this.showToolbar();
                Object.assign(this.dom.style, {
                    left: `${result.x}px`,
                    top: `${result.y}px`,
                });
            },
            {
                ancestorScroll: true,
                ancestorResize: true,
                elementResize: true,
                layoutShift: true,
                animationFrame: false,
            }
        );
    }
}

export const tableToolbarPlugin = ViewPlugin.fromClass(TableToolbarPlugin);

export const tableToolbarTheme = EditorView.baseTheme({
    [`.${CLASS_FLOATING_TOOLBAR}`]: {
        position: 'absolute',
        backgroundColor: 'var(--joplin-background-color)',
        border: '1px solid var(--joplin-divider-color)',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: '0 4px 12px var(--joplin-background-color-transparent2)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        alignItems: 'center',
        maxWidth: 'calc(100vw - 16px)',
        zIndex: '1000',
        fontSize: '13px',
    },
    '.cm-table-toolbar-btn': {
        background: 'none',
        border: '1px solid transparent',
        borderRadius: '4px',
        cursor: 'pointer',
        padding: '4px 8px',
        fontSize: 'inherit',
        color: 'var(--joplin-color)',
        whiteSpace: 'nowrap',
        transition: 'background-color 0.2s, color 0.2s, border-color 0.2s',
    },
    '.cm-table-toolbar-btn .cm-table-toolbar-icon': {
        width: '18px',
        height: '18px',
        display: 'block',
    },
    '.cm-table-toolbar-btn:has(.cm-table-toolbar-icon)': {
        padding: '4px 6px',
        lineHeight: '0',
    },
    '.cm-table-toolbar-btn:hover': {
        backgroundColor: 'var(--joplin-selected-color)',
        borderColor: 'var(--joplin-divider-color)',
    },
    '.cm-table-toolbar-separator': {
        width: '1px',
        height: '18px',
        backgroundColor: 'var(--joplin-divider-color)',
        margin: '0 4px',
    },
});
