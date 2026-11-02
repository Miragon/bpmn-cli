import { Box, DiagramIndex, type BpmnDocument, type BpmnElement } from '../../model/index.js';

interface DrawnItem {
  id: string;
  box: Box;
  whole: boolean;
  group?: BpmnElement | undefined;
}

export class GroupMembers {
  constructor(private readonly document: BpmnDocument) {}

  private static itemOf(shape: BpmnElement): DrawnItem | undefined {
    const element = shape.is('bpmndi:BPMNShape') ? shape.peek<BpmnElement>('bpmnElement') : undefined;
    const id = element?.peek<string>('id');
    const box = DiagramIndex.boxOf(shape.peek<BpmnElement>('bounds'));
    if (!element || !id || !box) {
      return undefined;
    }
    const whole = element.is('bpmn:Participant') || element.is('bpmn:Lane') || element.is('bpmn:Group') || shape.peek<boolean>('isExpanded') === true;
    return { id, box, whole, group: element.is('bpmn:Group') ? element : undefined };
  }

  private static held(group: DrawnItem, items: readonly DrawnItem[]): string[] {
    return items.filter((item) => item !== group && (item.whole ? item.box.isInside(group.box) : group.box.contains(item.box.center))).map(({ id }) => id);
  }

  of(): Map<string, string[]> {
    const groups = [...this.document.tree.walk()].filter((element) => element.is('bpmn:Group') && !!element.peek('id'));
    const byCategory = this.categoryMembers();
    const members = new Map(groups.map((group) => [group.id, byCategory.get(group.peek<BpmnElement>('categoryValueRef')!) ?? []]));
    for (const plane of this.document.diagram.planes()) {
      const items = plane.list('planeElement').flatMap((shape) => GroupMembers.itemOf(shape) ?? []);
      for (const item of items.filter(({ group }) => group)) {
        if (!members.get(item.id)?.length) {
          members.set(item.id, GroupMembers.held(item, items));
        }
      }
    }
    return members;
  }

  private categoryMembers(): Map<BpmnElement | undefined, string[]> {
    const members = new Map<BpmnElement | undefined, string[]>();
    for (const element of this.document.tree.all().values()) {
      for (const value of element.is('bpmn:FlowElement') ? element.list('categoryValueRef') : []) {
        members.set(value, [...(members.get(value) ?? []), element.id]);
      }
    }
    return members;
  }
}
