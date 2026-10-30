import { is } from '../../document/utils/moddle.js';
import { raw } from './raw.js';

/**
 * The dotted line of a text annotation to what it annotates. A crossing with it is no layout
 * problem: only another annotation line is routed around it, and the row choice of new nodes
 * takes it as a tie-break. A line through the annotation's text still counts. A compensation
 * association or a data association is no annotation line.
 */
export function isAnnotationLine(el: unknown): boolean {
  return is(el, 'bpmn:Association') && (is(raw(el, 'sourceRef'), 'bpmn:TextAnnotation') || is(raw(el, 'targetRef'), 'bpmn:TextAnnotation'));
}
