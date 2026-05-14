import type { TrankilV2IntentionRow } from '../api/trankilV2Db';
import { fetchPass3DailyRoadmapPromptTemplate } from './geminiRemoteModelSteering';
import { geminiPass3DailyRoadmapHtml } from './geminiSemanticLab';

export type RoadmapJsonIntention = {
  title: string;
  type: string;
  time: string;
  cat: string;
  age_days: number;
};

export type RoadmapPayload = {
  context: { date: string; lang: string };
  today_intentions: RoadmapJsonIntention[];
  orphan_intentions: RoadmapJsonIntention[];
};

const PASS3_CONSOLIDATED_SYSTEM_SUFFIX = `

Tu es l'intelligence de synthèse de l'application mobile. Ton rôle est de transformer une liste brute d'intentions SQL en une 'Feuille de Route' quotidienne structurée, motivante et ultra-lisible.

Focus du moment de la journée : Une phrase courte résumant l'énergie de la journée.

Logistique Newton : Identifie les TRIP, suggère un itinéraire ou un rappel de départ.

Coup de Boost : Sélectionne les 3-4 orphan_intentions les plus anciennes (utilise age_days) et interpelle l'utilisateur pour les réactiver.

Groupements : Crée des blocs SHOPPING, ADMINISTRATIF, MAISON , etc en fusionnant les items similaires.

Format : Renvoie uniquement du code HTML épuré (balises inline, pas de <html>/<body>).

LANGUE DU RAPPORT (Impératif) :
Analyse la langue utilisée dans les titres des intentions fournies (ex: français, anglais, espagnol).
Rédige l'intégralité du rapport (titres des sections, phrases de synthèse, conseils) dans cette même langue.
Si les intentions sont multilingues, utilise la langue définie dans context.lang comme référence prioritaire.`;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timeFromRemindAt(remindAt: number | null | undefined): string {
  if (!remindAt || remindAt <= 0) return '';
  const d = new Date(remindAt);
  if (!Number.isFinite(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function ageDaysFromCreated(createdAt: number): number {
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / 86400000));
}

/** Type affiché pour le modèle : TRIP si contexte déplacement. */
export function roadmapDisplayType(row: TrankilV2IntentionRow): string {
  const cat = String(row.category_id ?? '').toUpperCase();
  if (cat === 'TRAVEL') return 'TRIP';
  return row.type;
}

export function buildDailyRoadmapPayload(
  overdue: TrankilV2IntentionRow[],
  orphans: TrankilV2IntentionRow[],
  dateYmd: string,
  lang: string,
): RoadmapPayload {
  const toEntry = (row: TrankilV2IntentionRow): RoadmapJsonIntention => ({
    title: String(row.title ?? '').trim(),
    type: roadmapDisplayType(row),
    time: timeFromRemindAt(row.remind_at ?? null),
    cat: String(row.category_id ?? 'PERSO').trim() || 'PERSO',
    age_days: ageDaysFromCreated(row.created_at),
  });
  return {
    context: { date: dateYmd, lang: lang.split(/[-_]/)[0] || 'fr' },
    today_intentions: overdue.map(toEntry),
    orphan_intentions: orphans.map(toEntry),
  };
}

export async function composePass3SystemInstruction(): Promise<string> {
  const template = await fetchPass3DailyRoadmapPromptTemplate();
  return `${template.trim()}${PASS3_CONSOLIDATED_SYSTEM_SUFFIX}`;
}

export async function runDailyRoadmapGeminiHtml(args: {
  payload: RoadmapPayload;
  onAccumulatedText?: (full: string) => void;
  onPromptReady?: () => void;
}): Promise<string> {
  const systemInstruction = await composePass3SystemInstruction();
  args.onPromptReady?.();
  const userJson = JSON.stringify(args.payload);
  return geminiPass3DailyRoadmapHtml({
    systemInstruction,
    userJson,
    onAccumulatedText: args.onAccumulatedText,
  });
}
