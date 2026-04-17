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
