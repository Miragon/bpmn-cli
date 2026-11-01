import { TextMetrics } from '@miragon/bpmn-render/text';
import { Box, DiagramIndex, type BpmnElement, type BpmnTree } from '../../model/index.js';
import { GroupFit } from './GroupFit.js';
import { GroupRedraw, type RedrawnGroups } from './GroupRedraw.js';
import { GroupShapes, type RememberedGroup } from './GroupShapes.js';

export class Groups {
  private static readonly DEFAULT_SHAPE_ID = (id: string): string => `BPMNShape_${id}`;

  private readonly shapes: GroupShapes;

  constructor(private readonly tree: BpmnTree) {
    this.shapes = new GroupShapes(tree.definitions);
  }

  static membersOf(groups: readonly RememberedGroup[]): Map<string, string[]> {
    const membership = new Map<string, string[]>();
    for (const group of [...groups].sort((first, second) => GroupShapes.areaOf(second) - GroupShapes.areaOf(first))) {
      for (const id of group.members) {
        membership.set(id, [...(membership.get(id) ?? []), group.id]);
      }
    }
    return membership;
  }

  remembered(): RememberedGroup[] {
    const byValue = this.shapes.categoryMembers();
    return this.shapes.planes().flatMap((plane) => this.rememberedOn(plane, byValue));
  }

  undrawn(): RememberedGroup[] {
    const drawn = new Set(this.shapes.planes().flatMap((plane) => plane.list('planeElement')).filter((element) => element.is('bpmndi:BPMNShape')).map((shape) => shape.peek<BpmnElement>('bpmnElement')?.peek<string>('id') ?? ''));
    const byValue = this.shapes.categoryMembers();
    const undrawn: RememberedGroup[] = [];
    for (const [id, group] of this.shapes.groupElements()) {
      const value = group.peek<BpmnElement>('categoryValueRef');
      const members = (value && byValue.get(value)) || [];
      if (!drawn.has(id) && members.length) {
        undrawn.push(this.undrawnGroup(id, group, members));
      }
    }
    return undrawn;
  }

  relabel(group: BpmnElement, name: string): void {
    for (const planeElement of this.shapes.planes().flatMap((plane) => plane.list('planeElement'))) {
      const box = planeElement.is('bpmndi:BPMNShape') && planeElement.peek('bpmnElement') === group ? DiagramIndex.boxOf(planeElement.peek<BpmnElement>('bounds')) : undefined;
      if (box) {
        planeElement.set('label', name.trim() ? this.labelDi(GroupFit.labelOn(box, TextMetrics.labelSize(name))) : undefined);
      }
    }
  }

  redraw(groups: readonly RememberedGroup[], shapeId: (id: string) => string = Groups.DEFAULT_SHAPE_ID): RedrawnGroups {
    return new GroupRedraw(this.tree, this.shapes, shapeId).run(groups);
  }

  private rememberedOn(plane: BpmnElement, byValue: ReadonlyMap<BpmnElement, string[]>): RememberedGroup[] {
    const hasGroup = plane.list('planeElement').some((element) => element.is('bpmndi:BPMNShape') && !!element.peek<BpmnElement>('bpmnElement')?.is('bpmn:Group'));
    if (!hasGroup) {
      return [];
    }
    const shapes = GroupShapes.items(plane);
    const groups = [...shapes.values()].filter((item) => item.el.is('bpmn:Group'));
    return groups.map((group) => {
      const value = group.el.peek<BpmnElement>('categoryValueRef');
      const referenced = (value && byValue.get(value)) || [];
      const members = referenced.length ? referenced : [...shapes.values()].filter((shape) => shape !== group && GroupShapes.holds(group.box, shape)).map((shape) => shape.id);
      return { id: group.id, root: plane.peek<BpmnElement>('bpmnElement')?.peek<string>('id'), bounds: group.box, label: group.label, members };
    });
  }

  private undrawnGroup(id: string, group: BpmnElement, members: string[]): RememberedGroup {
    const name = group.name?.trim();
    const size = name ? TextMetrics.labelSize(name) : undefined;
    return { id, bounds: new Box(0, 0, 0, 0), label: size && new Box(0, 0, size.width, size.height), members };
  }

  private labelDi(box: Box): BpmnElement {
    return this.tree.build('bpmndi:BPMNLabel', { bounds: GroupRedraw.boundsDi(this.tree, box) });
  }
}
