import { useEffect } from 'react';

import { startSentinelRuntime } from '../services/traffic/sentinelRuntime';
import { configureSentinelBackgroundTask } from '../services/traffic/SentinelBackgroundService';

export function SentinelBootstrap() {
  useEffect(() => {
    void startSentinelRuntime();
    void configureSentinelBackgroundTask();
    return undefined;
  }, []);
  return null;
}
