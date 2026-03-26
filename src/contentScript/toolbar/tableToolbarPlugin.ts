import { ViewPlugin, ViewUpdate, EditorView } from '@codemirror/view';
import { activeCellField, type ActiveCell } from '../tableState/activeCellState';
import {
    execInsertRowAbove,
    execInsertRowBelow,
    execInsertColumnLeft,
    execInsertColumnRight,
    execDeleteRow,
    execDeleteColumn,
    execUpdateAlignment,
    execClearRow,
    execClearColumn,
    execClearTable,
    execDeleteTable,
    execMoveRowUp,
    execMoveRowDown,
    execMoveColumnLeft,
    execMoveColumnRight,
} from '../tableRuntime/operations/tableOperations';
import { computePosition, autoUpdate, offset, shift, hide } from '@floating-ui/dom';
import { syncAnnotation } from '../editorBridge/syncAnnotation';
import { rebuildTableWidgetsEffect } from '../tableState/tableWidgetEffects';
import { CLASS_FLOATING_TOOLBAR } from '../tableWidget/domHelpers';
import { focusMainEditorWithoutScroll } from '../shared/mainEditorFocus';

import {
    rowInsertTopIcon,
    rowInsertBottomIcon,
    rowRemoveIcon,
    columnInsertLeftIcon,
    columnInsertRightIcon,
    columnRemoveIcon,
    alignLeftIcon,
    alignCenterIcon,
    alignRightIcon,
    clearTableIcon,
    deleteTableIcon,
    moveColumnLeftIcon,
    moveColumnRightIcon,
    moveRowUpIcon,
    moveRowDownIcon,
} from './icons';
import { findTableWidgetElement } from '../tableWidget/domHelpers';
import { makeTableId } from '../tableModel/types';

class TableToolbarPlugin {
    dom: HTMLElement;
    private currentActiveCell: ActiveCell | null = null;
    private cleanupAutoUpdate: (() => void) | null = null;
    private cleanupViewportListeners: (() => void) | null = null;

    constructor(private view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = CLASS_FLOATING_TOOLBAR;
        this.dom.style.position = 'absolute';
        this.dom.style.display = 'none';

        // Add buttons
        this.createButtons();

        view.dom.appendChild(this.dom);
    }

    update(update: ViewUpdate) {
        const prevActiveCell = this.currentActiveCell;
        this.currentActiveCell = update.state.field(activeCellField);

        // Active cell state changed
        if (!!prevActiveCell !== !!this.currentActiveCell) {
            if (this.currentActiveCell) {
                // Defer until widget DOM is ready (runs in CM's measure cycle after DOM update)
                this.schedulePositionUpdate();
            } else {
                this.cleanupPositioning();
                this.hideToolbar();
            }
            return;
        }

        // Active cell changed to different table
        if (this.currentActiveCell && prevActiveCell && this.currentActiveCell.tableFrom !== prevActiveCell.tableFrom) {
            // Defer until new table widget DOM is ready
            this.schedulePositionUpdate();
            return;
        }

        // Check for conditions that usually imply the widget DOM was replaced/rebuilt:
        // 1. rebuildTableWidgetsEffect (explicit structural edit)
        // 2. Doc changes that are NOT sync (e.g. Undo/Redo, external edits).
        //    Non-sync changes cause `tableDecorationField` to rebuild decorations,
        //    which leads to CodeMirror replacing the widget DOM if content changed.
        const isNonSyncDocChange = update.transactions.some((tr) => tr.docChanged && !tr.annotation(syncAnnotation));
        const hasRebuildEffect = update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(rebuildTableWidgetsEffect))
        );

        if (this.currentActiveCell && (hasRebuildEffect || isNonSyncDocChange)) {
            // Defer until rebuilt widget DOM is ready
            this.schedulePositionUpdate();
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
                focusMainEditorWithoutScroll(this.view);
            };
            btn.appendChild(svg);
            btn.classList.add('cm-table-toolbar-icon-btn');
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
        createIconBtn('Clear row', 'Clear row', clearTableIcon(), () => {
            if (this.currentActiveCell) {
                execClearRow(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Move row up', 'Move row up', moveRowUpIcon(), () => {
            if (this.currentActiveCell) {
                execMoveRowUp(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Move row down', 'Move row down', moveRowDownIcon(), () => {
            if (this.currentActiveCell) {
                execMoveRowDown(this.view, this.currentActiveCell);
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
        createIconBtn('Clear column', 'Clear column', clearTableIcon(), () => {
            if (this.currentActiveCell) {
                execClearColumn(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Move column left', 'Move column left', moveColumnLeftIcon(), () => {
            if (this.currentActiveCell) {
                execMoveColumnLeft(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Move column right', 'Move column right', moveColumnRightIcon(), () => {
            if (this.currentActiveCell) {
                execMoveColumnRight(this.view, this.currentActiveCell);
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

        createIconBtn('Clear table', 'Clear table', clearTableIcon(), () => {
            if (this.currentActiveCell) {
                execClearTable(this.view, this.currentActiveCell);
            }
        });
        createIconBtn('Delete table', 'Delete table', deleteTableIcon(), () => {
            if (this.currentActiveCell) {
                execDeleteTable(this.view, this.currentActiveCell);
            }
        });
    }

    private showToolbar() {
        this.dom.style.display = 'flex';
        this.dom.style.visibility = 'visible';
    }

    private hideToolbar() {
        // We use display: none to ensure it is removed from the layout/paint immediately.
        // This prevents "ghosting" or lingering 1-frame artifacts.
        this.dom.style.display = 'none';
        this.dom.style.visibility = 'hidden';
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
        if (this.cleanupViewportListeners) {
            this.cleanupViewportListeners();
            this.cleanupViewportListeners = null;
        }
    }

    /**
     * Schedules a position update using CodeMirror's measure cycle.
     * Runs after DOM updates are complete, in the same frame.
     * Using `key` dedupes multiple requests within the same update cycle.
     */
    private schedulePositionUpdate() {
        this.view.requestMeasure({
            key: this,
            read: () => null,
            write: () => this.updatePosition(),
        });
    }

    private updatePosition() {
        if (!this.currentActiveCell) {
            this.cleanupPositioning();
            this.hideToolbar();
            return;
        }

        const referenceElement = findTableWidgetElement(this.view, makeTableId(this.currentActiveCell.tableFrom));

        if (!referenceElement) {
            this.cleanupPositioning();
            this.hideToolbar();
            return;
        }

        this.cleanupPositioning();
        this.prepareToolbarForPositioning();

        const scrollDOM = this.view.scrollDOM;
        const isInternalScroll = scrollDOM.scrollHeight > scrollDOM.clientHeight + 1;
        if (!isInternalScroll) {
            // External scroll (mobile) doesn't reliably trigger autoUpdate's ancestor scroll handlers.
            this.cleanupViewportListeners = this.attachViewportListeners();
        }

        this.cleanupAutoUpdate = autoUpdate(
            referenceElement,
            this.dom,
            async () => {
                // Ensure element is measurable (display:flex) but hidden (visibility:hidden)
                // before asking Floating UI to compute position.
                this.prepareToolbarForPositioning();

                // Check if reference element is still in the DOM
                if (!referenceElement.isConnected) {
                    // Don't cleanup here - just hide and let the next update() call handle cleanup
                    this.hideToolbar();
                    return;
                }

                const toolbarRect = this.dom.getBoundingClientRect();
                const tableRect = referenceElement.getBoundingClientRect();
                const scrollDOMRect = scrollDOM.getBoundingClientRect();
                // Desktop uses internal CM scrolling; mobile uses external WebView scrolling.
                // For internal scroll, the visible viewport is the scrollDOM rect.
                // For external scroll, use visualViewport/window dimensions anchored to the page.
                const visualViewport = window.visualViewport;
                const viewportHeight = isInternalScroll
                    ? scrollDOMRect.height
                    : (visualViewport?.height ?? window.innerHeight);
                const viewportTop = isInternalScroll ? scrollDOMRect.top : 0;
                const viewportBottom = isInternalScroll ? scrollDOMRect.bottom : viewportHeight;

                const tableAboveViewport = tableRect.bottom <= viewportTop;
                const tableBelowViewport = tableRect.top >= viewportBottom;

                if (tableAboveViewport || tableBelowViewport) {
                    this.hideToolbar();
                    return;
                }

                const topVisible = tableRect.top >= viewportTop && tableRect.top <= viewportBottom;
                const bottomVisible = tableRect.bottom >= viewportTop && tableRect.bottom <= viewportBottom;
                const hasRoomAbove =
                    tableRect.top - toolbarRect.height - TOOLBAR_OFFSET_PX >= viewportTop + TOOLBAR_VIEWPORT_PADDING_PX;
                const hasRoomBelow =
                    viewportBottom - tableRect.bottom - toolbarRect.height - TOOLBAR_OFFSET_PX >=
                    TOOLBAR_VIEWPORT_PADDING_PX;

                let result = null as Awaited<ReturnType<typeof computePosition>> | null;
                let manualPosition = null as { x: number; y: number; fixed?: boolean } | null;

                const middleware = [offset(TOOLBAR_OFFSET_PX), shift({ padding: TOOLBAR_VIEWPORT_PADDING_PX }), hide()];

                if (topVisible && hasRoomAbove) {
                    result = await computePosition(referenceElement, this.dom, {
                        placement: 'top-start',
                        middleware,
                    });
                } else if (bottomVisible && hasRoomBelow) {
                    result = await computePosition(referenceElement, this.dom, {
                        placement: 'bottom-start',
                        middleware,
                    });
                } else {
                    // Pinned mode: toolbar sticks to viewport edge when table top/bottom is out of view.
                    const placeAbove = (tableRect.top + tableRect.bottom) / 2 > viewportTop + viewportHeight / 2;

                    if (isInternalScroll) {
                        // Desktop (internal scroll): use position: absolute with offset parent calculations
                        // to keep the toolbar within the editor panel bounds.
                        const viewRect = this.view.dom.getBoundingClientRect();
                        const offsetParent = (this.dom.offsetParent ?? document.body) as HTMLElement;
                        const offsetParentRect = offsetParent.getBoundingClientRect();

                        const minX = TOOLBAR_VIEWPORT_PADDING_PX;
                        const maxX = Math.max(
                            TOOLBAR_VIEWPORT_PADDING_PX,
                            viewRect.width - toolbarRect.width - TOOLBAR_VIEWPORT_PADDING_PX
                        );
                        const x = Math.min(Math.max(tableRect.left - viewRect.left, minX), maxX);

                        const topInParent = viewportTop - offsetParentRect.top + TOOLBAR_VIEWPORT_PADDING_PX;
                        const bottomInParent =
                            viewportBottom - offsetParentRect.top - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING_PX;
                        const y = placeAbove ? topInParent : Math.max(topInParent, bottomInParent);
                        manualPosition = { x, y, fixed: false };
                    } else {
                        // Mobile (external scroll): use position: fixed with viewport-relative coordinates
                        // to avoid jitter caused by offset parent recalculations during scroll.
                        // Mobile editor disables pinch-zoom (maximum-scale=1), so pageLeft should be 0.
                        const viewportWidth = visualViewport?.width ?? window.innerWidth;
                        const minX = TOOLBAR_VIEWPORT_PADDING_PX;
                        const maxX = Math.max(
                            TOOLBAR_VIEWPORT_PADDING_PX,
                            viewportWidth - toolbarRect.width - TOOLBAR_VIEWPORT_PADDING_PX
                        );
                        const x = Math.min(Math.max(tableRect.left, minX), maxX);

                        const y = placeAbove
                            ? viewportTop + TOOLBAR_VIEWPORT_PADDING_PX
                            : viewportBottom - toolbarRect.height - TOOLBAR_VIEWPORT_PADDING_PX;

                        manualPosition = { x, y, fixed: true };
                    }
                }

                if (result?.middlewareData.hide?.referenceHidden) {
                    this.hideToolbar();
                    return;
                }

                // Avoid rendering if we somehow produced a non-finite position.
                if (
                    (result && (!Number.isFinite(result.x) || !Number.isFinite(result.y))) ||
                    (manualPosition && (!Number.isFinite(manualPosition.x) || !Number.isFinite(manualPosition.y)))
                ) {
                    this.hideToolbar();
                    return;
                }

                // If we positioned relative to the table, keep the existing obscuration guard.
                if (result && result.placement.startsWith('top') && result.y < TOOLBAR_OBSCURATION_THRESHOLD_PX) {
                    const fallback = await computePosition(referenceElement, this.dom, {
                        placement: 'bottom-start',
                        middleware,
                    });
                    if (!fallback.middlewareData.hide?.referenceHidden) {
                        result = fallback;
                    }
                }

                this.showToolbar();
                if (manualPosition) {
                    Object.assign(this.dom.style, {
                        position: manualPosition.fixed ? 'fixed' : 'absolute',
                        left: `${manualPosition.x}px`,
                        top: `${manualPosition.y}px`,
                    });
                    return;
                }
                // Reset to absolute positioning for Floating UI results
                this.dom.style.position = 'absolute';
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

    private attachViewportListeners() {
        const handler = () => {
            this.schedulePositionUpdate();
        };

        document.addEventListener('scroll', handler, { passive: true });
        window.addEventListener('resize', handler);
        window.visualViewport?.addEventListener('scroll', handler);
        window.visualViewport?.addEventListener('resize', handler);

        return () => {
            document.removeEventListener('scroll', handler);
            window.removeEventListener('resize', handler);
            window.visualViewport?.removeEventListener('scroll', handler);
            window.visualViewport?.removeEventListener('resize', handler);
        };
    }
}

const TOOLBAR_OFFSET_PX = 5;
const TOOLBAR_VIEWPORT_PADDING_PX = 5;
const TOOLBAR_OBSCURATION_THRESHOLD_PX = 5;

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
        zIndex: '100',
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
    '.cm-table-toolbar-icon-btn': {
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
