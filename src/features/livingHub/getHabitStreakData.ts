/** État d'une occurrence attendue dans le semainier compact. */
export type HabitOccurrenceState = 'done' | 'missed' | 'today' | 'skip';

export type HabitStreakData = {
  streakCount: number;
  history: HabitOccurrenceState[];
};

/**
 * Données de série pour le rendu UI (bouchon — branchement logs SQLite à venir).
 * 1 case = 1 occurrence attendue (jour, semaine, etc.).
 */
export function getHabitStreakData(intentionId: string): HabitStreakData {
  void intentionId;
  return {
    streakCount: 3,
    history: ['done', 'done', 'missed', 'done', 'done', 'done', 'today'],
  };
}
