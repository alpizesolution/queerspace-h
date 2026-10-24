import { isFirebaseConfigured, auth } from '../lib/firebase.ts';

export interface StorageOperationResult {
  savedLocally: boolean;
  savedToCloud: boolean;
  error?: string | null;
  userMessage: string;
}

/**
 * Generates honest, accurate feedback messages based on execution outcome.
 * Never claims cloud success unless cloud write explicitly resolved.
 */
export function formatSyncFeedback(
  actionName: string,
  localSuccess: boolean,
  cloudAttempted: boolean,
  cloudSuccess: boolean,
  cloudError?: string | null
): StorageOperationResult {
  if (cloudAttempted && cloudSuccess) {
    return {
      savedLocally: localSuccess,
      savedToCloud: true,
      error: null,
      userMessage: `${actionName} saved to cloud securely.`,
    };
  }

  if (cloudAttempted && !cloudSuccess && localSuccess) {
    return {
      savedLocally: true,
      savedToCloud: false,
      error: cloudError || 'Cloud unavailable',
      userMessage: `${actionName} — Cloud sync unavailable, saved locally.`,
    };
  }

  if (localSuccess && (!cloudAttempted || !isFirebaseConfigured)) {
    return {
      savedLocally: true,
      savedToCloud: false,
      error: null,
      userMessage: `${actionName} saved locally (Offline Demo Mode).`,
    };
  }

  return {
    savedLocally: false,
    savedToCloud: false,
    error: cloudError || 'Save operation failed',
    userMessage: `Failed to save ${actionName.toLowerCase()}. Please try again.`,
  };
}

/**
 * Safe wrapper for storage writes that enforces honest feedback
 */
export async function executeHonestStorageWrite<T>(
  actionName: string,
  localSaver: () => boolean,
  cloudSaver?: () => Promise<boolean>
): Promise<StorageOperationResult> {
  let localSuccess = false;
  try {
    localSuccess = localSaver();
  } catch (err) {
    localSuccess = false;
  }

  let cloudAttempted = false;
  let cloudSuccess = false;
  let cloudErrMessage: string | null = null;

  if (cloudSaver) {
    cloudAttempted = true;
    try {
      cloudSuccess = await cloudSaver();
    } catch (err: unknown) {
      cloudSuccess = false;
      cloudErrMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[SyncFeedback] ${actionName} cloud save notice:`, cloudErrMessage);
    }
  }


  return formatSyncFeedback(
    actionName,
    localSuccess,
    cloudAttempted,
    cloudSuccess,
    cloudErrMessage
  );
}
