export type BotChannel = 'whatsapp' | 'telegram' | 'slack' | 'line';

export type GenericBotPayload = {
  channel: BotChannel;
  messengerUserId: string;
  text: string;
  description?: string;
};
