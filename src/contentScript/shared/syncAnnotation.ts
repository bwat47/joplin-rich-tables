import { Annotation } from '@codemirror/state';

/** Annotation used to mark synchronization transactions to prevent loops. */
export const syncAnnotation = Annotation.define<boolean>();
