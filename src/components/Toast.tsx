'use client';

import { useEffect } from 'react';

const Z_INDEX_TOAST = 10000;

export interface ToastProps {
  message: string;
  type: 'error' | 'success' | 'info';
  onClose: () => void;
  /** Auto-dismiss duration in ms (default: 3000, set to 0 to disable) */
  duration?: number;
}

/**
 * Toast notification component.
 * Auto-dismisses after duration (default 3s).
 */
export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const bgColor = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-green-600' : 'bg-blue-600';

  return (
    <div
      className={`fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up text-sm`}
      style={{ zIndex: Z_INDEX_TOAST }}
    >
      <span>{message}</span>
      <button onClick={onClose} className="text-white/80 hover:text-white">&times;</button>
    </div>
  );
}
