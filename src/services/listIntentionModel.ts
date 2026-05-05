/**
 * Modèle **liste inventaire scalable** : sérialisation dans `metadata_json` sous
 * la clé {@link LIST_METADATA_KEY} (fusion avec le JSON existant de l’intention).
 *
 * @module listIntentionModel
 */

export const LIST_METADATA_KEY = 'list_scalable_v1';

export type ListItemUnitKey = 'g' | 'kg' | 'piece' | 'cl' | 'l';

export type ListItemStored = {
  uid: string;
  name: string;
  qty: number;
  unit: string;
  scalable: boolean;
  checked?: boolean;
  note?: string;
  due_date?: string | null;
};

export type ListItemDraft = {
  name: string;
  baseQuantity?: number;
  qty?: number;
  unit?: string;
  scalable?: boolean;
  includeInSave?: boolean;
  note?: string;
  due_date?: string | null;
};

export type ListCategoryDraft = {
  name: string;
  items: ListItemDraft[];
};

export type ListDraftBlock = {
  title: string;
  baseCount: number;
  unitLabel: string;
  categories: ListCategoryDraft[];
};

export type ListCategoryStored = {
  name: string;
  items: ListItemStored[];
};

export type ListScalablePayload = {
  title: string;
  baseCount: number;
  unitLabel: string;
  multiplier: number;
  categories: ListCategoryStored[];
};

const ALLOWED_UNITS = new Set(['g', 'kg', 'piece', 'cl', 'l']);

/**
 * Ramène une unité libre (ex. typo, synonyme) vers une clé supportée.
 *
 * @param u — Valeur brute issue du JSON ou du formulaire.
 * @returns Clé normalisée parmi `g`, `kg`, `piece`, `cl`, `l` (défaut : `piece`).
 */
function normalizeUnit(u: unknown): string {
  const s = String(u ?? 'piece')
    .trim()
    .toLowerCase();
  if (ALLOWED_UNITS.has(s)) return s;
  if (s === 'pcs' || s === 'pc' || s === 'pièce' || s === 'pieces' || s === 'unité' || s === 'unite')
    return 'piece';
  if (s === 'ml') return 'cl';
  return 'piece';
}

/**
 * Garantit un `uid` stable par item (pour la persistance des cases cochées).
 *
 * @param payload — Charge utile liste (potentiellement sans `uid` sur les items).
 * @returns Même structure avec `uid` renseignés.
 */
function assignUids(payload: ListScalablePayload): ListScalablePayload {
  return {
    ...payload,
    categories: payload.categories.map((cat, ci) => ({
      ...cat,
      items: cat.items.map((it, ii) => ({
        ...it,
        uid: it.uid && String(it.uid).trim() ? it.uid : `L${ci}_${ii}`,
      })),
    })),
  };
}

export function parseListScalablePayloadFromMetadataJson(raw: string | null | undefined): ListScalablePayload | null {
  if (!raw) return null;
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const block = root[LIST_METADATA_KEY];
    if (!block || typeof block !== 'object') return null;
    const o = block as Record<string, unknown>;
    const title = String(o.title ?? '').trim();
    if (!title) return null;
    const baseCount = Math.max(1, Math.round(Number(o.baseCount ?? 1)));
    const unitLabel = String(o.unitLabel ?? 'personne').trim() || 'personne';
    const multiplier = Math.max(1, Math.round(Number(o.multiplier ?? 1)));
    const catsRaw = o.categories;
    if (!Array.isArray(catsRaw)) return null;
    const categories: ListCategoryStored[] = catsRaw.map((c) => {
      const cr = c as Record<string, unknown>;
      const name = String(cr.name ?? '').trim() || '—';
      const itemsRaw = cr.items;
      const items: ListItemStored[] = Array.isArray(itemsRaw)
        ? itemsRaw.map((it) => {
            const ir = it as Record<string, unknown>;
            return {
              uid: String(ir.uid ?? '').trim(),
              name: String(ir.name ?? '').trim() || '—',
              qty: Math.max(0, Number(ir.qty ?? 0)),
              unit: normalizeUnit(ir.unit),
              scalable: Boolean(ir.scalable),
              checked: Boolean(ir.checked),
              note: String(ir.note ?? '').trim() || undefined,
              due_date: typeof ir.due_date === 'string' && ir.due_date.trim() ? ir.due_date.trim() : null,
            };
          })
        : [];
      return { name, items };
    });
    return assignUids({ title, baseCount, unitLabel, multiplier, categories });
  } catch {
    return null;
  }
}

export type GeminiListCategory = { name: string; items: { name: string; qty: number; unit: string; scalable: boolean }[] };

export type GeminiListInventoryJson = {
  title: string;
  baseCount: number;
  unitLabel: string;
  categories: GeminiListCategory[];
};

/**
 * Construit une chaîne JSON liste pour {@link parseGeminiListInventoryJson},
 * en excluant les lignes dont `includeInSave === false` (cases à cocher modale one-tap).
 *
 * @throws {Error} `LIST_NO_ITEMS_SELECTED` si plus aucune ligne après filtre.
 */
export function buildListInventoryJsonStringFromDraftBlock(
  list: Record<string, unknown>,
  fallbackTitle: string,
): string {
  const listTitle = String(list.title ?? '').trim() || String(fallbackTitle ?? '').trim();
  if (!listTitle) throw new Error('LIST_JSON_MISSING_TITLE');
  const baseCount = Math.max(1, Math.round(Number(list.baseCount ?? 1)));
  const unitLabel = String(list.unitLabel ?? 'personne').trim() || 'personne';
  const catsRaw = list.categories;
  const categories: GeminiListCategory[] = (Array.isArray(catsRaw) ? catsRaw : []).map((c) => {
    const cr = c as Record<string, unknown>;
    const name = String(cr.name ?? '').trim() || '—';
    const itemsRaw = cr.items;
    const items =
      Array.isArray(itemsRaw) && itemsRaw.length > 0
        ? itemsRaw
            .filter((it) => (it as Record<string, unknown>).includeInSave !== false)
            .map((it) => {
              const ir = it as Record<string, unknown>;
              const perPerson =
                ir.baseQuantity !== undefined && ir.baseQuantity !== null
                  ? Number(ir.baseQuantity)
                  : Number(ir.qty ?? 0);
              return {
                name: String(ir.name ?? '').trim() || '—',
                qty: Math.max(0, perPerson),
                unit: normalizeUnit(ir.unit),
                scalable: Boolean(ir.scalable),
              };
            })
        : [];
    return { name, items };
  }).filter((cat) => cat.items.length > 0);
  if (categories.length === 0) throw new Error('LIST_NO_ITEMS_SELECTED');
  return JSON.stringify({
    title: listTitle,
    baseCount,
    unitLabel,
    categories,
  });
}

/**
 * Parse la réponse texte Gemini (JSON pur ou entouré de fences ```).
 *
 * @param raw — Texte renvoyé par le modèle.
 * @returns Objet validé {@link GeminiListInventoryJson}.
 * @throws {Error} Codes `LIST_JSON_*` si le JSON est incomplet.
 */
export function parseGeminiListInventoryJson(raw: string): GeminiListInventoryJson {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const obj = JSON.parse(s) as Record<string, unknown>;
  const title = String(obj.title ?? '').trim();
  if (!title) throw new Error('LIST_JSON_MISSING_TITLE');
  const baseCount = Math.max(1, Math.round(Number(obj.baseCount ?? 1)));
  const unitLabel = String(obj.unitLabel ?? 'personne').trim() || 'personne';
  const cats = obj.categories;
  if (!Array.isArray(cats) || cats.length === 0) throw new Error('LIST_JSON_MISSING_CATEGORIES');
  const categories: GeminiListCategory[] = cats.map((c) => {
    const cr = c as Record<string, unknown>;
    const name = String(cr.name ?? '').trim() || '—';
    const itemsRaw = cr.items;
    const items =
      Array.isArray(itemsRaw) && itemsRaw.length > 0
        ? itemsRaw.map((it) => {
            const ir = it as Record<string, unknown>;
            const perPerson =
              ir.baseQuantity !== undefined && ir.baseQuantity !== null
                ? Number(ir.baseQuantity)
                : Number(ir.qty ?? 0);
            return {
              name: String(ir.name ?? '').trim() || '—',
              qty: Math.max(0, perPerson),
              unit: normalizeUnit(ir.unit),
              scalable: Boolean(ir.scalable),
            };
          })
        : [];
    return { name, items };
  });
  if (categories.every((c) => c.items.length === 0)) throw new Error('LIST_JSON_EMPTY_ITEMS');
  return { title, baseCount, unitLabel, categories };
}

/**
 * Convertit la sortie Gemini en charge persistée (qty = quantité par personne, multiplicateur = baseCount).
 *
 * @param g — JSON validé côté Gemini.
 * @returns {@link ListScalablePayload} prêt pour SQLite / UI.
 */
export function geminiJsonToStoredPayload(g: GeminiListInventoryJson): ListScalablePayload {
  const headcount = Math.max(1, Math.round(Number(g.baseCount ?? 1)));
  const categories: ListCategoryStored[] = g.categories.map((cat) => ({
    name: cat.name,
    items: cat.items.map((it) => ({
      uid: '',
      name: it.name,
      qty: it.qty,
      unit: it.unit,
      scalable: it.scalable,
      checked: false,
    })),
  }));
  return assignUids({
    title: g.title,
    baseCount: headcount,
    unitLabel: g.unitLabel,
    multiplier: headcount,
    categories,
  });
}

/**
 * @param payload — État liste à persister.
 * @returns Patch metadata à passer à `patchMetadata`.
 */
export function buildListMetadataPatch(payload: ListScalablePayload): Record<string, unknown> {
  return { [LIST_METADATA_KEY]: payload };
}
