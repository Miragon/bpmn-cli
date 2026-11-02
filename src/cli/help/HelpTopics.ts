import { readFileSync } from 'node:fs';
import { BpmnError } from '../../api/index.js';

export class HelpTopics {
  private static readonly CORE = 'guide/core';

  private static readonly FOLDERS: Readonly<Record<string, string>> = {
    contract: 'guide',
    workflow: 'guide',
    reading: 'guide',
    output: 'guide',
    layout: 'guide',
    format: 'guide',
    render: 'guide',
    ops: 'tables',
    placement: 'guide',
    triggers: 'tables',
    errors: 'guide',
    quoting: 'guide',
    camunda7: 'project',
    camunda8: 'project',
    bpmnlint: 'project',
    conventions: 'project',
    commands: 'guide',
    kinds: 'tables',
    'set-keys': 'tables',
    'nested-keys': 'tables',
    'zeebe-elements': 'tables',
    ids: 'project',
    colors: 'tables',
    'exit-codes': 'tables',
  };

  static names(): string[] {
    return Object.keys(HelpTopics.FOLDERS);
  }

  static text(topics: readonly string[]): string {
    const paths = topics.length > 0 ? topics.map(HelpTopics.pathOf) : [HelpTopics.CORE];
    return paths.map(HelpTopics.read).join('\n');
  }

  private static read(path: string): string {
    return readFileSync(new URL(`./${path}.md`, import.meta.url), 'utf8');
  }

  private static pathOf(this: void, topic: string): string {
    const name = HelpTopics.names().find((candidate) => HelpTopics.spelling(candidate) === HelpTopics.spelling(topic));
    if (!name) {
      throw BpmnError.usage(`Unknown guide topic "${topic}"`, { candidates: HelpTopics.names(), hint: 'Pass listed topics, or none for the core: `bpmn guide`.' });
    }
    return `${HelpTopics.FOLDERS[name]}/${name}`;
  }

  private static spelling(topic: string): string {
    return topic.toLowerCase().replace(/[\s_-]/g, '');
  }
}
