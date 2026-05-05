import { randomUUID } from 'expo-crypto';

export function newUuidV4(): string {
  return randomUUID();
}

