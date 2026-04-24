import { useEffect } from 'react';
import { InteractionManager } from 'react-native';

import { getNotifications } from '../services/notifications';
import {
  bootstrapNativeAlarmsOnAppStart,
  handleRailAlarmDelivered,
} from '../services/alarmManager';

/**
 * Au démarrage : replanifie les alarmes natives depuis SQLite (reboot, perte de process).
 * Écoute les livraisons `rail_alarm` pour avancer les RRULE (une occurrence à la fois).
 * Le bootstrap est différé après les interactions + 2 s pour ne pas concurrencer le TTI (splash / Timeline).
 */
export function NativeAlarmBootstrap() {
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const interactionHandle = InteractionManager.runAfterInteractions(() => {
      timeoutId = setTimeout(() => {
        void bootstrapNativeAlarmsOnAppStart();
      }, 2000);
    });

    const n = getNotifications();
    const subReceive = n
      ? n.addNotificationReceivedListener((notification) => {
          const data = notification.request.content.data;
          if (data?.kind !== 'rail_alarm' || typeof data.intentionId !== 'string') {
            return;
          }
          void handleRailAlarmDelivered(data.intentionId);
        })
      : null;
    const subResponse = n
      ? n.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data;
          if (data?.kind !== 'rail_alarm' || typeof data.intentionId !== 'string') {
            return;
          }
          void handleRailAlarmDelivered(data.intentionId);
        })
      : null;

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      interactionHandle.cancel();
      subReceive?.remove();
      subResponse?.remove();
    };
  }, []);

  return null;
}
