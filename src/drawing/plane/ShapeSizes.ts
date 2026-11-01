import { TextMetrics } from '@miragon/bpmn-render/text';
import type { BpmnElement } from '../../model/index.js';

export interface ShapeSize {
  width: number;
  height: number;
}

export interface LayoutGaps {
  hGap: number;
  vGap: number;
  loopGap: number;
  boundaryOffset: number;
}

export class ShapeSizes {
  static readonly TASK: Readonly<ShapeSize> = { width: 100, height: 80 };
  static readonly EVENT: Readonly<ShapeSize> = { width: 36, height: 36 };
  static readonly GATEWAY: Readonly<ShapeSize> = { width: 50, height: 50 };
  static readonly DATA_OBJECT: Readonly<ShapeSize> = { width: 36, height: 50 };
  static readonly DATA_STORE: Readonly<ShapeSize> = { width: 50, height: 50 };
  static readonly NEW_SUB_PROCESS: Readonly<ShapeSize> = { width: 350, height: 200 };
  static readonly SUB_PROCESS_MIN: Readonly<ShapeSize> = { width: 200, height: 120 };
  static readonly SUB_PROCESS_PADDING = { top: 45, right: 30, bottom: 30, left: 30 } as const;
  static readonly PARTICIPANT_HEADER = 30;
  static readonly LANE_HEADER = 30;
  static readonly LANE_PADDING = 30;
  static readonly BLACK_BOX_HEIGHT = 60;
  static readonly POOL_GAP = 80;
  static readonly OUTER_MARGIN = 80;
  static readonly GAPS: Readonly<LayoutGaps> = { hGap: 60, vGap: 60, loopGap: 30, boundaryOffset: 25 };

  private static readonly ANNOTATION_MIN_WIDTH = 100;
  private static readonly ANNOTATION_MAX_WIDTH = 300;
  private static readonly ANNOTATION_MIN_HEIGHT = 30;
  private static readonly ANNOTATION_WIDTH_STEP = 20;
  private static readonly ANNOTATION_CHAR_WIDTH = 6.5;

  static of(element: BpmnElement): ShapeSize {
    if (element.is('bpmn:Event')) {
      return { ...ShapeSizes.EVENT };
    }
    if (element.is('bpmn:Gateway')) {
      return { ...ShapeSizes.GATEWAY };
    }
    if (element.is('bpmn:DataObjectReference')) {
      return { ...ShapeSizes.DATA_OBJECT };
    }
    if (element.is('bpmn:DataStoreReference')) {
      return { ...ShapeSizes.DATA_STORE };
    }
    if (element.is('bpmn:TextAnnotation')) {
      return ShapeSizes.ofAnnotation(element.peek<string>('text'));
    }
    return { ...ShapeSizes.TASK };
  }

  static ofAnnotation(text: string | undefined): ShapeSize {
    const textWidth = (text ?? '').length * ShapeSizes.ANNOTATION_CHAR_WIDTH;
    const steps = Math.ceil((textWidth + 24) / ShapeSizes.ANNOTATION_WIDTH_STEP);
    const width = Math.min(ShapeSizes.ANNOTATION_MAX_WIDTH, Math.max(ShapeSizes.ANNOTATION_MIN_WIDTH, steps * ShapeSizes.ANNOTATION_WIDTH_STEP));
    const lines = Math.max(1, Math.ceil(textWidth / (width - 14)));
    return { width, height: Math.max(ShapeSizes.ANNOTATION_MIN_HEIGHT, lines * TextMetrics.LABEL_LINE + 12) };
  }
}
