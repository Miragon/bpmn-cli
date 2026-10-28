/** `userTask`, `activity, gateway, event, multiInstanceLoopCharacteristics`: element types as a message names them, the first four only. */
export function kindsText(owners: string[]): string {
  const names = owners.map((owner) => {
    const local = owner.replace(/^bpmn:/, '');
    return local.charAt(0).toLowerCase() + local.slice(1);
  });
  return names.length > 4 ? `${names.slice(0, 4).join(', ')}, ...` : names.join(', ');
}
