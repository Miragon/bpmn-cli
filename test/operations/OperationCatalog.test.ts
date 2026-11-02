import { describe, expect, it } from 'vitest';
import { OperationCatalog } from '../../src/operations/OperationCatalog.js';

describe('OperationCatalog', () => {
  it('holds 9 model and 8 drawing operations, align out, layout in', () => {
    expect(OperationCatalog.MODEL.map(({ name }) => name)).toEqual(['add', 'connect', 'set', 'remove', 'retype', 'move', 'order', 'ext', 'split']);
    expect(OperationCatalog.DRAWING.map(({ name }) => name)).toEqual(['layout', 'tidy', 'compact', 'place', 'color', 'label', 'route', 'space']);
    expect(OperationCatalog.names()).toHaveLength(17);
  });

  it('finds a definition by name, and none for a retired one', () => {
    expect(OperationCatalog.find('add')?.name).toBe('add');
    expect(OperationCatalog.find('align')).toBeUndefined();
  });

  it('tells a drawing operation from a model operation', () => {
    expect(OperationCatalog.isDrawing({ op: 'layout' })).toBe(true);
    expect(OperationCatalog.isDrawing({ op: 'remove', ids: ['a'] })).toBe(false);
  });
});
