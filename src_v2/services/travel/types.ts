export type TravelMode = 'WALK' | 'BIKE' | 'TRANSIT' | 'CAR' | 'MIXED';

export type DestinationKind =
  | 'HOME'
  | 'WORK'
  | 'HEALTH'
  | 'SPORT'
  | 'STATION'
  | 'AIRPORT'
  | 'SHOPPING'
  | 'SCHOOL'
  | 'OTHER';

export type TravelRisk = 'CALM' | 'TENSE' | 'GO';

export type TravelContext = {
  nowMs: number;
  transcript: string;
  destinationLabel?: string;
  arrivalAtMs?: number;
};

export type TravelPrediction = {
  destinationKind: DestinationKind;
  mode: TravelMode;
  baseDurationMin: number;
  trafficMultiplier: number;
  uncertaintyMin: number;
  bufferRecommendedMin: number;
  estimatedDoorToDoorMin: number;
  criticalDepartAtMs: number | null;
  bufferSafetyMin: number | null;
  risk: TravelRisk;
  nextJumpMs: number;
  elasticity: number;
};

export type TravelOutcome = {
  destinationKind: DestinationKind;
  mode: TravelMode;
  startedAtMs: number;
  arrivedAtMs: number;
  predictedDoorToDoorMin: number;
};

export type TravelRiskCode = 0 | 1 | 2;

export type TravelSnapshot = {
  t: number;
  dk: DestinationKind;
  m: TravelMode;
  e: number;
  r: TravelRiskCode;
  eta: number;
  buf: number;
  dep: number | null;
  nxt: number;
};

export type TravelSchedulerState = {
  lastMapsAtMs: number | null;
  lastDoorToDoorMin: number | null;
  lastElasticity: number;
  running: boolean;
};

