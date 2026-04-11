import { useEffect, useRef } from 'react';

import { subscribeRailInbox } from '../api/railInbox';
import { useUserSpectrum } from '../context/UserSpectrumContext';

/**
 * Écoute `devices/{deviceId}/rail_inbox` (intentions injectées côté serveur / bots).
 */
export function RailInboxBootstrap() {
  const { spectrum } = useUserSpectrum();
  const spectrumRef = useRef(spectrum);
  spectrumRef.current = spectrum;

  useEffect(() => {
    return subscribeRailInbox(() => spectrumRef.current);
  }, []);

  return null;
}
