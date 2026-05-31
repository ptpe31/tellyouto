/**
 * Façade Sentinel — toutes les notifications trajet passent par {@link ../NotificationService.ts}.
 *
 * Implémentation legacy (appels directs expo-notifications, ID `sentinel_*`) : archivée dans
 * `nettoyage-code-mort.md` §7 — ne pas réactiver sans migration vers NotificationService.
 */
import {
  cancelTripNotifications,
  SENTINEL_ACTION_LAUNCH_ROUTE,
  SENTINEL_NOTIFICATION_CATEGORY_ID,
  SENTINEL_NOTIFICATION_CHANNEL_ID,
  sendTripGoNoGoNotification,
  sendTripProbeUnavailableNotification,
  sendTripPromiseDriftSoftNotification,
  TRIP_ACTION_LAUNCH_ROUTE,
  TRIP_NOTIFICATION_CATEGORY_ID,
  updateTripStickyFromSentinel,
} from '../NotificationService';

export {
  SENTINEL_ACTION_LAUNCH_ROUTE,
  SENTINEL_NOTIFICATION_CATEGORY_ID,
  SENTINEL_NOTIFICATION_CHANNEL_ID,
  TRIP_ACTION_LAUNCH_ROUTE,
  TRIP_NOTIFICATION_CATEGORY_ID,
};

export class SentinelNotificationManager {
  async update(input: Parameters<typeof updateTripStickyFromSentinel>[0]): Promise<void> {
    return updateTripStickyFromSentinel(input);
  }

  async sendGoNoGoPush(input: Parameters<typeof sendTripGoNoGoNotification>[0]): Promise<void> {
    return sendTripGoNoGoNotification(input);
  }

  async sendProbeUnavailablePush(
    input: Parameters<typeof sendTripProbeUnavailableNotification>[0],
  ): Promise<void> {
    return sendTripProbeUnavailableNotification(input);
  }

  async sendPromiseDriftSoftPush(
    input: Parameters<typeof sendTripPromiseDriftSoftNotification>[0],
  ): Promise<void> {
    return sendTripPromiseDriftSoftNotification(input);
  }

  async cancel(tripTaskId: string): Promise<void> {
    return cancelTripNotifications(tripTaskId);
  }
}
