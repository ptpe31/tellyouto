import React, { useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { Snackbar } from 'react-native-paper';

import { APP_TOAST_EVENT, type AppToastPayload } from '../constants/appToastEvents';

export function AppToastHost() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const durationRef = useRef(4000);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(APP_TOAST_EVENT, (payload: AppToastPayload) => {
      setMessage(String(payload?.message || '').trim() || '…');
      durationRef.current = Math.max(2000, Math.min(8000, Number(payload?.durationMs) || 4200));
      setVisible(true);
    });
    return () => sub.remove();
  }, []);

  return (
    <Snackbar
      visible={visible}
      onDismiss={() => setVisible(false)}
      duration={durationRef.current}
      style={{ marginBottom: 12 }}
      action={{ label: 'OK', onPress: () => setVisible(false) }}
    >
      {message}
    </Snackbar>
  );
}
