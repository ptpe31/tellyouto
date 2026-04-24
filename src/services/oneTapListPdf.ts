import type { OneTapUniversalResult } from './oneTapUniversalCapture';
import { listItemDisplayQuantity } from '../utils/listQuantityDisplay';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Génère un PDF imprimable (cases à cocher, quantités selon le nombre de personnes).
 */
export async function printOneTapListDraft(draft: OneTapUniversalResult): Promise<void> {
  if (draft.predictedType !== 'LIST') return;
  const list = draft.data.list as Record<string, unknown> | undefined;
  if (!list || typeof list !== 'object') return;
  const title = escapeHtml(String(draft.title || list.title || 'Liste').trim() || 'Liste');
  const numberOfPeople = Math.max(1, Math.round(Number(list.baseCount ?? 1)));
  const cats = Array.isArray(list.categories) ? list.categories : [];
  const rows: string[] = [];
  for (const cat of cats) {
    const cr = cat as Record<string, unknown>;
    const catName = escapeHtml(String(cr.name ?? '').trim() || '—');
    rows.push(`<tr><td colspan="3" class="cat">${catName}</td></tr>`);
    const itemsRaw = cr.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw : [];
    for (const it of items) {
      const ir = it as Record<string, unknown>;
      const label = escapeHtml(String(ir.name ?? '').trim() || '—');
      const unit = escapeHtml(String(ir.unit ?? '').trim());
      const qty = listItemDisplayQuantity(ir, numberOfPeople);
      const qtyStr = qty > 0 ? `${qty}${unit ? ` ${unit}` : ''}` : '';
      rows.push(
        `<tr><td class="cb">☐</td><td class="qty">${escapeHtml(qtyStr)}</td><td class="nm">${label}</td></tr>`,
      );
    }
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;color:#111;background:#fff;}
h1{font-size:18px;margin:0 0 8px;color:#008080;}
.sub{color:#666;font-size:12px;margin-bottom:16px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
td{padding:6px 4px;border-bottom:1px solid #e5e5e5;vertical-align:top;}
td.cat{font-weight:700;color:#FF8C00;padding-top:14px;border-bottom:none;}
td.cb{width:28px;font-size:16px;}
td.qty{width:72px;white-space:nowrap;color:#333;}
td.nm{}
</style></head><body>
<h1>${title}</h1>
<div class="sub">${numberOfPeople} pers.</div>
<table>${rows.join('')}</table>
</body></html>`;
  /** Import dynamique : évite de charger le module natif au démarrage ; Expo Go / binaire non rebuild → erreur explicite. */
  let Print: typeof import('expo-print');
  try {
    Print = await import('expo-print');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      msg.includes('ExpoPrint') || msg.includes('native module')
        ? 'PRINT_NATIVE_MODULE_MISSING'
        : msg,
    );
  }
  try {
    await Print.printAsync({ html });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ExpoPrint') || msg.includes('native module')) {
      throw new Error('PRINT_NATIVE_MODULE_MISSING');
    }
    throw e;
  }
}
