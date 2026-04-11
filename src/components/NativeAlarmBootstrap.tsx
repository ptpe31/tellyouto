import { useEffect } from 'react';

import { getNotifications } from '../services/notifications';
import {
  bootstrapNativeAlarmsOnAppStart,
  handleRailAlarmDelivered,
} from '../services/alarmManager';

/**
 * Au démarrage : replanifie les alarmes natives depuis SQLite (reboot, perte de process).
 * Écoute les livraisons `rail_alarm` pour avancer les RRULE (une occurrence à la fois).
 */
export function NativeAlarmBootstrap() {
  useEffect(() => {
    void bootstrapNativeAlarmsOnAppStart();

    const n = getNotifications();
    if (!n) return undefined;

    const subReceive = n.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.kind !== 'rail_alarm' || typeof data.intentionId !== 'string') {
        return;
      }
      void handleRailAlarmDelivered(data.intentionId);
    });

    const subResponse = n.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.kind !== 'rail_alarm' || typeof data.intentionId !== 'string') {
        return;
      }
      void handleRailAlarmDelivered(data.intentionId);
    });

    return () => {
      subReceive.remove();
      subResponse.remove();
    };
  }, []);

  return null;
}
