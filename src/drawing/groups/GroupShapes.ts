import { DiagramIndex, type Box, type BpmnElement } from '../../model/index.js';

export interface GroupItem {
  id: string;
  el: BpmnElement;
  box: Box;
  label?: Box | undefined;
  whole: boolean;
  host?: string | undefined;
}

export interface RememberedGroup {
  id: string;
  root?: string | undefined;
  bounds: Box;
  label?: Box | undefined;
  members: string[];
}

export class GroupShapes {
  constructor(private readonly definitions: BpmnElement) {}

  static items(plane: BpmnElement | undefined): Map<string, GroupItem> {
    const items = new Map<string, GroupItem>();
    for (const planeElement of plane?.list('planeElement') ?? []) {
      const item = planeElement.is('bpmndi:BPMNShape') ? GroupShapes.itemOf(planeElement) : undefined;
      if (item && !items.has(item.id)) {
        items.set(item.id, item);
      }
    }
    return items;
  }

  static holds(box: Box, item: GroupItem): boolean {
    return item.whole ? item.box.isInside(box) : box.contains(item.box.center);
  }

  static areaOf(group: RememberedGroup): number {
    return group.bounds.width * group.bounds.height;
  }

  private static itemOf(planeElement: BpmnElement): GroupItem | undefined {
    const el = planeElement.peek<BpmnElement>('bpmnElement');
    const id = el?.peek<string>('id');
    const box = DiagramIndex.boxOf(planeElement.peek<BpmnElement>('bounds'));
    if (!el || !id || !box) {
      return undefined;
    }
    const label = DiagramIndex.boxOf(planeElement.peek<BpmnElement>('label')?.peek<BpmnElement>('bounds'));
    const whole = el.is('bpmn:Participant') || el.is('bpmn:Lane') || el.is('bpmn:Group') || planeElement.peek<boolean>('isExpanded') === true;
    const host = el.is('bpmn:BoundaryEvent') ? el.peek<BpmnElement>('attachedToRef')?.peek<string>('id') : undefined;
    return { id, el, box, whole, label, host };
  }

  private static isProcess(root: BpmnElement): boolean {
    return root.is('bpmn:Process');
  }

  planes(): BpmnElement[] {
    return this.definitions.list('diagrams').flatMap((diagram) => diagram.peek<BpmnElement>('plane') ?? []);
  }

  categoryMembers(): Map<BpmnElement, string[]> {
    const members = new Map<BpmnElement, string[]>();
    const visit = (scope: BpmnElement): void => {
      for (const element of scope.list('flowElements')) {
        const id = element.peek<string>('id');
        for (const value of id ? element.list('categoryValueRef') : []) {
          members.set(value, [...(members.get(value) ?? []), id!]);
        }
        if (element.list('flowElements').length) {
          visit(element);
        }
      }
    };
    this.definitions.list('rootElements').filter(GroupShapes.isProcess).forEach(visit);
    return members;
  }

  groupElements(): Map<string, BpmnElement> {
    const groups = new Map<string, BpmnElement>();
    const visit = (scope: BpmnElement): void => {
      for (const artifact of scope.list('artifacts')) {
        const id = artifact.is('bpmn:Group') ? artifact.peek<string>('id') : undefined;
        if (id) {
          groups.set(id, artifact);
        }
      }
      for (const element of scope.list('flowElements')) {
        if (element.list('flowElements').length || element.list('artifacts').length) {
          visit(element);
        }
      }
    };
    this.definitions.list('rootElements').forEach(visit);
    return groups;
  }
}
