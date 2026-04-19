import { DeviceEventEmitter } from 'react-native';

import { APP_TOAST_EVENT, type AppToastPayload } from '../constants/appToastEvents';

export function showAppToast(message: string, durationMs = 4200): void {
  DeviceEventEmitter.emit(APP_TOAST_EVENT, { message, durationMs } satisfies AppToastPayload);
}
