import * as TaskManager from 'expo-task-manager';

export const BACKGROUND_SYNC_TASK = 'TELLYOUTO_BACKGROUND_SYNC';

/**
 * Tâche arrière-plan enregistrée au chargement du module (requis par Expo).
 * Étendre le corps pour la sync locale ↔ cloud.
 */
if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    return;
  });
}
