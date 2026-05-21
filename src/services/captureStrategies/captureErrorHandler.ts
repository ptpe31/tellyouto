/** DEPRECATED — jamais importé. Voir `nettoyage-code-mort.md` §10. */
import { Alert } from 'react-native';

import { showAppToast } from '../appToast';
import { isLikelyTransientNetworkCaptureError } from '../captureOfflineFirstUtils';
import { alertNativeModuleMissing, isLikelyMissingNativeModuleError } from '../../utils/nativeModuleErrorAlert';

export type CaptureErrorHandlerContext = {
  translate: (key: string, options?: Record<string, string | number>) => string;
  /** Ancien flux pré-débit micro ; laisser vide avec la politique « succès uniquement ». */
  refundPendingCaptureCredit?: () => Promise<void>;
  alertTitleKey?: string;
  /** Si le message d’erreur est vide, affiche cette clé i18n. */
  fallbackMessageKey?: string;
};

/**
 * Gestion d’erreur centralisée pour les flux de capture : remboursement crédit + alerte lisible.
 */
export async function handleCaptureFlowError(
  error: unknown,
  ctx: CaptureErrorHandlerContext,
): Promise<void> {
  void error;
  void ctx;
  return;
  /* corps original ci-dessous — inaccessible
  if (ctx.refundPendingCaptureCredit) {
    await ctx.refundPendingCaptureCredit();
  }

  if (isLikelyMissingNativeModuleError(error)) {
    alertNativeModuleMissing('nativeModule.contextTalkHomePersist', error);
    return;
  }

  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (
    isLikelyTransientNetworkCaptureError(error) ||
    lower.includes('gemini') ||
    lower.includes('network') ||
    lower.includes('fetch')
  ) {
    showAppToast(ctx.translate('capture.offlineNoteGenericToast'));
    return;
  }
  const title = ctx.translate(ctx.alertTitleKey ?? 'tabs.debug');
  const message =
    raw.trim() ||
    (ctx.fallbackMessageKey ? ctx.translate(ctx.fallbackMessageKey) : '') ||
    ctx.translate('tabs.debug');
  Alert.alert(title, message);
  */
}
