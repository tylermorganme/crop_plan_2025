'use client';

import type { BedGroup } from '@/lib/entities';
import { Z_INDEX } from '@/lib/z-index';

interface DeleteGroupModalProps {
  group: BedGroup;
  onAction: (action: 'cancel' | 'delete') => void;
}

export default function DeleteGroupModal({ group, onAction }: DeleteGroupModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Delete Group</h2>
        </div>

        <div className="px-6 py-4">
          <p className="text-gray-700">
            Are you sure you want to delete the group <strong>{group.name}</strong>?
            This action cannot be undone.
          </p>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-lg flex justify-end gap-3">
          <button
            onClick={() => onAction('cancel')}
            className="px-4 py-2 text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            onClick={() => onAction('delete')}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
          >
            Delete Group
          </button>
        </div>
      </div>
    </div>
  );
}
