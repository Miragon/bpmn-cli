/**
 * Readable, deterministic ids.
 *
 * Convention (bpmn-js family prefixes + a slug of the name):
 *   Activity_CheckInvoice, Event_OrderReceived, Gateway_InvoiceOk, Flow_3,
 *   Participant_Customer, Lane_Sales, DataObjectReference_Order, ...
 *
 * Unnamed elements get a numeric suffix (max existing + 1, never reused
 * while the maximum exists). Name collisions get _2, _3, ...
 */

const MAX_SLUG = 40;

/** ASCII-only PascalCase slug of a name, or '' when nothing usable remains. */
export function slugify(name: string | undefined): string {
  if (!name) return '';
  const ascii = name
    .normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[̀-ͯ]/g, '');
  const words = ascii.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let slug = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  if (slug.length > MAX_SLUG) {
    slug = slug.slice(0, MAX_SLUG);
  }
  return slug;
}

/** BPMN ids must be XML NCNames. */
export function isValidId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id);
}

export class IdRegistry {
  private readonly used = new Set<string>();

  constructor(existing: Iterable<string> = []) {
    for (const id of existing) this.used.add(id);
  }

  has(id: string): boolean {
    return this.used.has(id);
  }

  claim(id: string): void {
    this.used.add(id);
  }

  release(id: string): void {
    this.used.delete(id);
  }

  /**
   * Next free id for a prefix. With a name: `<prefix>_<Slug>` (then `_2`, `_3`
   * on collision); without: `<prefix>_<n>` with n = max existing + 1.
   */
  next(prefix: string, name?: string): string {
    const slug = slugify(name);
    let id: string;
    if (slug) {
      const base = `${prefix}_${slug}`;
      id = base;
      let n = 2;
      while (this.used.has(id)) id = `${base}_${n++}`;
    } else {
      const re = new RegExp(`^${escapeRegExp(prefix)}_(\\d+)$`);
      let max = 0;
      for (const existing of this.used) {
        const m = re.exec(existing);
        if (m) max = Math.max(max, Number(m[1]));
      }
      id = `${prefix}_${max + 1}`;
      while (this.used.has(id)) id = `${prefix}_${++max + 1}`;
    }
    this.used.add(id);
    return id;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
