import { describe, expect, it } from 'vitest';
import { NameSuggestion } from '../../../../src/checks/camunda/rules/NameSuggestion.js';

describe('NameSuggestion', () => {
  it('finds the closest name, whatever its case', () => {
    expect(new NameSuggestion().closest('asignee', ['assignee', 'candidateUsers'])).toBe('assignee');
    expect(new NameSuggestion().closest('ASSIGNEE', ['assignee'])).toBe('assignee');
  });

  it('prefers a name of the element over an equally close one', () => {
    expect(new NameSuggestion().closest('topik', ['topiq'], ['topic'])).toBe('topic');
  });

  it('suggests nothing that is too far off', () => {
    expect(new NameSuggestion().closest('priority', ['assignee'])).toBeUndefined();
  });
});
