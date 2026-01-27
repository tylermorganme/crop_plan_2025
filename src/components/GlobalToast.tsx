'use client';

import { useUIStore } from '@/lib/ui-store';
import { Toast } from './Toast';

/**
 * Global toast component that reads from ui-store.
 * Add this to layout.tsx to enable toasts across all pages.
 *
 * Usage from any component:
 *   const setToast = useUIStore(s => s.setToast);
 *   setToast({ message: 'Success!', type: 'success' });
 */
export function GlobalToast() {
  const toast = useUIStore(s => s.toast);
  const setToast = useUIStore(s => s.setToast);

  if (!toast) return null;

  return (
    <Toast
      message={toast.message}
      type={toast.type}
      onClose={() => setToast(null)}
    />
  );
}
