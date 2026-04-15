export type GeminiExpertIntention = {
  type: 'TASK' | 'HABIT' | 'NOTE' | 'PROJECT';
  title: string;
  metadata: Record<string, unknown>;
  suggested_category: string;
};

export function askGeminiExpert(input: string): Promise<GeminiExpertIntention[]>;

export function atomizeProject(audioText: string): Promise<GeminiExpertIntention[]>;
