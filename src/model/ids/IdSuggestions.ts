import type { BpmnElement } from '../document/BpmnElement.js';
import { EditDistance } from './EditDistance.js';
import { IdSlug } from './IdSlug.js';

export interface BatchContext {
  created: string[];
  renamed: Map<string, string>;
  retyped?: Set<string>;
  aliases: () => Record<string, string>;
}

interface Query {
  lower: string;
  folded: string;
  foldedStem: string;
  prefix: string | undefined;
  renamed: string | undefined;
}

interface Hit {
  id: string;
  score: number;
  dist: number;
}

export class IdSuggestions {
  constructor(
    private readonly elements: ReadonlyMap<string, BpmnElement>,
    private readonly batch?: BatchContext,
  ) {}

  private static foldUmlauts(text: string): string {
    return IdSlug.transliterate(text)
      .toLowerCase()
      .replace(/ae/g, 'a')
      .replace(/oe/g, 'o')
      .replace(/ue/g, 'u')
      .replace(/ss/g, 's')
      .replace(/[^a-z0-9]/g, '');
  }

  private static prefixOf(id: string): string | undefined {
    return /^([A-Za-z][A-Za-z0-9]*)_./.exec(id)?.[1]!.toLowerCase();
  }

  private static stemOf(id: string): string {
    const separatorIndex = id.indexOf('_');
    return separatorIndex === -1 ? id : id.slice(separatorIndex + 1);
  }

  for(query: string, max = 5): string[] {
    const asked = this.queryOf(query);
    const recent = new Set(this.batch?.created ?? []);
    const hits: Hit[] = [];
    for (const [id, element] of this.elements) {
      const hit = IdSuggestions.closeness(asked, id, String(element.get<string | undefined>('name') ?? '').toLowerCase());
      if (hit) {
        hits.push({ id, ...hit });
      }
    }
    const fresh = (id: string): number => (recent.has(id) ? 0 : 1);
    const own = (hit: Hit): number => (hit.score < 0 || (asked.prefix && IdSuggestions.prefixOf(hit.id) === asked.prefix) ? 0 : 1);
    return hits
      .sort((left, right) => own(left) - own(right) || left.score - right.score || fresh(left.id) - fresh(right.id) || left.dist - right.dist || left.id.localeCompare(right.id))
      .slice(0, max)
      .map((hit) => hit.id);
  }

  private queryOf(query: string): Query {
    return {
      lower: query.toLowerCase(),
      folded: IdSuggestions.foldUmlauts(query),
      foldedStem: IdSuggestions.foldUmlauts(IdSuggestions.stemOf(query)),
      prefix: IdSuggestions.prefixOf(query),
      renamed: this.batch?.renamed.get(query),
    };
  }

  private static closeness(asked: Query, id: string, name: string): Omit<Hit, 'id'> | undefined {
    const folded = IdSuggestions.foldUmlauts(id);
    const foldedStem = IdSuggestions.foldUmlauts(IdSuggestions.stemOf(id));
    if (id === asked.renamed) {
      return { score: -1, dist: 0 };
    }
    if (id.toLowerCase() === asked.lower) {
      return { score: 0, dist: 0 };
    }
    if ((asked.folded && folded === asked.folded) || (asked.foldedStem.length >= 3 && foldedStem === asked.foldedStem)) {
      return { score: 1, dist: 0 };
    }
    if (IdSuggestions.contains(asked, id, folded, foldedStem)) {
      return { score: 2, dist: 0 };
    }
    return IdSuggestions.typo(asked, folded, foldedStem) ?? IdSuggestions.byText(asked, id, name);
  }

  private static contains(asked: Query, id: string, folded: string, foldedStem: string): boolean {
    if (asked.folded && (folded.includes(asked.folded) || (folded.length >= 3 && asked.folded.includes(folded)))) {
      return true;
    }
    const samePrefix = !!asked.prefix && IdSuggestions.prefixOf(id) === asked.prefix;
    return samePrefix && asked.foldedStem.length >= 3 && foldedStem.length >= 6 && (foldedStem.includes(asked.foldedStem) || asked.foldedStem.includes(foldedStem));
  }

  private static typo(asked: Query, folded: string, foldedStem: string): Omit<Hit, 'id'> | undefined {
    const whole = EditDistance.transposing(asked.folded, folded);
    if (asked.folded && whole <= EditDistance.typoTolerance(asked.folded.length)) {
      return { score: 3, dist: whole };
    }
    const bare = EditDistance.transposing(asked.foldedStem, foldedStem);
    return asked.foldedStem && bare <= EditDistance.typoTolerance(asked.foldedStem.length) ? { score: 3, dist: bare } : undefined;
  }

  private static byText(asked: Query, id: string, name: string): Omit<Hit, 'id'> | undefined {
    if (name && (name === asked.lower || name.includes(asked.lower) || (!!asked.folded && IdSuggestions.foldUmlauts(name).includes(asked.folded)))) {
      return { score: 4, dist: 0 };
    }
    const bare = (text: string): string => text.replace(/[^a-z0-9]/g, '');
    return bare(asked.lower) && bare(id.toLowerCase()).includes(bare(asked.lower)) ? { score: 5, dist: 0 } : undefined;
  }
}
