import { useEffect } from 'react';

/**
 * Warns user when they try to navigate away or close the tab with unsaved changes.
 */
export function useUnsavedChanges(hasChanges: boolean) {
  // Browser tab close / refresh
  useEffect(() => {
    if (!hasChanges) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);
}

