export const APP_TOAST_EVENT = 'tellyouto_app_toast';

export type AppToastPayload = {
  message: string;
  durationMs?: number;
};
