import { editDistance, typoTolerance } from './utils/fuzzy.js';
import { transliterate } from './utils/slug.js';
import { suggestKinds } from './utils/kinds.js';
import type { Doc } from './Doc.js';

/** The ids of a document a mistyped id may have meant. */
export class IdSuggestions {
  constructor(private readonly doc: Doc) {}

  /** Pruefung, Prufung and Prüfung fold to the same key. */
  private static foldUmlauts(text: string): string {
    return transliterate(text)
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

  /**
   * "Did you mean" ids, best first: the batch's rename, another case / umlaut spelling / prefix,
   * containment, a typo, a matching name. Ids with the query's prefix come first (a mistyped
   * `Flow_...` suggests flows), then ids the running batch created.
   */
  for(query: string, max = 5): string[] {
    const lowerQuery = query.toLowerCase();
    const fq = IdSuggestions.foldUmlauts(query);
    const fstem = IdSuggestions.foldUmlauts(IdSuggestions.stemOf(query));
    const batch = this.doc.edit.batch;
    const recent = new Set(batch?.created ?? []);
    const renamed = batch?.renamed.get(query);
    const prefix = IdSuggestions.prefixOf(query);
    const hits: Array<{ id: string; score: number; dist: number }> = [];
    for (const [id, el] of this.doc.byId()) {
      const name = String(el.get<string | undefined>('name') ?? '').toLowerCase();
      const lid = id.toLowerCase();
      const fid = IdSuggestions.foldUmlauts(id);
      const fidStem = IdSuggestions.foldUmlauts(IdSuggestions.stemOf(id));
      let score = Infinity;
      let dist = 0;
      if (id === renamed) score = -1;
      else if (lid === lowerQuery) score = 0;
      else if ((fq && fid === fq) || (fstem.length >= 3 && fidStem === fstem)) score = 1;
      else if (fq && (fid.includes(fq) || (fid.length >= 3 && fq.includes(fid)))) score = 2;
      // Flow_GatewayPurchaseApprovedToOrderGoods -> Flow_PurchaseApprovedToOrderGoods
      else if (prefix && IdSuggestions.prefixOf(id) === prefix && fstem.length >= 3 && fidStem.length >= 6 && (fidStem.includes(fstem) || fstem.includes(fidStem))) score = 2;
      else {
        const whole = editDistance(fq, fid);
        const bare = editDistance(fstem, fidStem);
        if (fq && whole <= typoTolerance(fq.length)) [score, dist] = [3, whole];
        else if (fstem && bare <= typoTolerance(fstem.length)) [score, dist] = [3, bare];
        else if (name && (name === lowerQuery || name.includes(lowerQuery) || (!!fq && IdSuggestions.foldUmlauts(name).includes(fq)))) score = 4;
        else if (lowerQuery.replace(/[^a-z0-9]/g, '') && lid.replace(/[^a-z0-9]/g, '').includes(lowerQuery.replace(/[^a-z0-9]/g, ''))) score = 5;
      }
      if (score < Infinity) hits.push({ id, score, dist });
    }
    if (!hits.length) {
      // last resort: kind-alike suggestions are not ids; return nothing
      void suggestKinds;
    }
    const fresh = (id: string): number => (recent.has(id) ? 0 : 1);
    const own = (hit: { id: string; score: number }): number => (hit.score < 0 || (prefix && IdSuggestions.prefixOf(hit.id) === prefix) ? 0 : 1);
    return hits
      .sort((left, right) => own(left) - own(right) || left.score - right.score || fresh(left.id) - fresh(right.id) || left.dist - right.dist || left.id.localeCompare(right.id))
      .slice(0, max)
      .map((hit) => hit.id);
  }
}
