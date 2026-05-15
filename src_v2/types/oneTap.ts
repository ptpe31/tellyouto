export type UiLocale = 'fr' | 'en';

export type OneTapPredictedType = 'TASK' | 'RECURRING_TASK' | 'HABIT' | 'LIST' | 'ANNIVERSARY' | 'NOTE';

export type OneTapUniversalData = {
  dueDateYmd?: string;
  dueTimeHm?: string;
  preferredTimeHm?: string;
  dueAtIso?: string;
  lang?: string;
  logistics?: {
    hasLogistics: boolean;
    destination: string | null;
    isLocationIncomplete: boolean;
  };
  hasLogistics?: boolean;
  isLocationIncomplete?: boolean;
  adjustForTraffic?: boolean;
  cadenceDescription?: string;
  notes?: string;
  destinationName?: string;
  locationLabel?: string;
  listItems?: string[];
  smartScaling?: {
    pivotValue: number;
    unitLabel: string;
    items: { t: string; qty: number; isScalable: boolean }[];
  };
  personName?: string;
  monthDay?: string;
  memo?: string;
  elasticityFactor?: number;
};

export type OneTapUniversalResult = {
  predictedType: OneTapPredictedType;
  categoryTag: string;
  contextTag: string;
  title: string;
  data: OneTapUniversalData;
};

export type OneTapCapturePerf = {
  pathAStartMs: number;
  pathAEndMs: number;
  pathBStartMs: number | null;
  pathBEndMs: number | null;
};

