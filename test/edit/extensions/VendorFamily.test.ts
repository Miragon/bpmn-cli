import { describe, expect, it } from 'vitest';
import { VendorFamily } from '../../../src/edit/extensions/VendorFamily.js';

describe('VendorFamily', () => {
  it('reads an Operaton element under the Camunda rule of the same name', () => {
    expect(new VendorFamily('operaton:inputParameter').ruleName()).toBe('camunda:inputParameter');
    expect(new VendorFamily('zeebe:input').ruleName()).toBe('zeebe:input');
  });

  it('spells a Camunda type the way an Operaton sibling spells it', () => {
    expect(new VendorFamily('operaton:inputOutput').spell('camunda:inputParameter')).toBe('operaton:inputParameter');
    expect(new VendorFamily('operaton:inputOutput').spell('zeebe:input')).toBe('zeebe:input');
    expect(new VendorFamily('camunda:inputOutput').spell('camunda:inputParameter')).toBe('camunda:inputParameter');
  });

  it('counts Operaton into the Camunda family and Zeebe out of it', () => {
    expect(new VendorFamily('operaton:field').isCamunda()).toBe(true);
    expect(new VendorFamily('camunda:field').isCamunda()).toBe(true);
    expect(new VendorFamily('zeebe:header').isCamunda()).toBe(false);
  });

  it('spells every step and quoted type of an example path for Operaton', () => {
    const path = "camunda:formField[id='camunda:x']/camunda:validation";

    expect(new VendorFamily('operaton:constraint').spellPath(path)).toBe("operaton:formField[id='operaton:x']/operaton:validation");
    expect(new VendorFamily('camunda:constraint').spellPath(path)).toBe(path);
  });
});
