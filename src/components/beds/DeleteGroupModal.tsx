'use client';

import type { BedGroup } from '@/lib/entities';
import { Z_INDEX } from '@/lib/z-index';

interface DeleteGroupModalProps {
  group: BedGroup;
  bedCount: number;
  plantingCount: number;
  onAction: (action: 'cancel' | 'delete' | 'deleteWithBeds') => void;
}

export default function DeleteGroupModal({
  group,
  bedCount,
  plantingCount,
  onAction,
}: DeleteGroupModalProps) {
  const hasBeds = bedCount > 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: Z_INDEX.MODAL }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Delete Group</h2>
        </div>

        <div className="px-6 py-4">
          {hasBeds ? (
            <>
              <p className="text-gray-700 mb-4">
                <strong>{group.name}</strong> contains{' '}
                <strong>
                  {bedCount} bed{bedCount !== 1 ? 's' : ''}
                </strong>
                {plantingCount > 0 && (
                  <>
                    {' '}
                    with{' '}
                    <strong>
                      {plantingCount} planting{plantingCount !== 1 ? 's' : ''}
                    </strong>{' '}
                    assigned
                  </>
                )}
                .
              </p>
              <p className="text-gray-600 text-sm mb-4">
                Deleting this group will also delete all beds in it.
                {plantingCount > 0 && (
                  <> Any plantings will be unassigned and can be reassigned to other beds later.</>
                )}
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>Warning:</strong> This will permanently delete {bedCount} bed
                {bedCount !== 1 ? 's' : ''}.
                {plantingCount > 0 && (
                  <> {plantingCount} planting{plantingCount !== 1 ? 's' : ''} will need to be
                  manually reassigned.</>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-700">
              Are you sure you want to delete <strong>{group.name}</strong>? This action cannot be
              undone.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-lg flex justify-end gap-3">
          <button
            onClick={() => onAction('cancel')}
            className="px-4 py-2 text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          {hasBeds ? (
            <button
              onClick={() => onAction('deleteWithBeds')}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Delete Group & {bedCount} Bed{bedCount !== 1 ? 's' : ''}
            </button>
          ) : (
            <button
              onClick={() => onAction('delete')}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Delete Group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
