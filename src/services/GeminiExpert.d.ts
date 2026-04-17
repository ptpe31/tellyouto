export type GeminiExpertIntention = {
  type: 'TASK' | 'HABIT' | 'NOTE' | 'PROJECT';
  title: string;
  metadata: Record<string, unknown>;
  suggested_category: string;
};

export function askGeminiExpert(input: string): Promise<GeminiExpertIntention[]>;

export function atomizeProject(audioText: string): Promise<GeminiExpertIntention[]>;

export type GeminiHabitRecurrence = {
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number;
  interval: number;
};

export function extractHabitRecurrence(input: string): Promise<GeminiHabitRecurrence | null>;

export type GeminiAnniversaryDetails = {
  personName: string;
  type: 'ANNIVERSARY';
  recurrence: 'yearly';
  native_date: string;
};

export function extractAnniversaryDetails(input: string): Promise<GeminiAnniversaryDetails | null>;
