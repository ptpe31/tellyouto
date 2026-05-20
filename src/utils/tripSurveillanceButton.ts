export type TripSurveillanceUiState =
  | 'all_day'
  | 'free_locked'
  | 'pro_incomplete'
  | 'pro_inactive'
  | 'pro_active';

export function resolveTripSurveillanceUiState(input: {
  isProUser: boolean;
  tripIsAllDay: boolean;
  remindToLeaveEnabled: boolean;
  canEnableRemindToLeave: boolean;
}): TripSurveillanceUiState {
  if (input.tripIsAllDay) return 'all_day';
  if (!input.isProUser) return 'free_locked';
  if (input.remindToLeaveEnabled) return 'pro_active';
  if (!input.canEnableRemindToLeave) return 'pro_incomplete';
  return 'pro_inactive';
}

export function tripSurveillanceLabelKey(state: TripSurveillanceUiState): string {
  switch (state) {
    case 'free_locked':
      return 'intentionDetail.tripSurveillanceStartLocked';
    case 'pro_active':
      return 'intentionDetail.tripSurveillanceActive';
    default:
      return 'intentionDetail.tripSurveillanceStart';
  }
}
