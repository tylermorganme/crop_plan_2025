'use client';

import type { Bed } from '@/lib/entities';
import { Z_INDEX } from '@/lib/z-index';

interface DeleteBedModalProps {
  bed: Bed;
  plantingCount: number;
  onAction: (action: 'cancel' | 'delete' | 'unassign') => void;
}

export default function DeleteBedModal({ bed, plantingCount, onAction }: DeleteBedModalProps) {
  const hasPlantings = plantingCount > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center" style={{ zIndex: Z_INDEX.MODAL }}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Delete Bed</h2>
        </div>

        <div className="px-6 py-4">
          {hasPlantings ? (
            <>
              <p className="text-gray-700 mb-4">
                <strong>{bed.name}</strong> has{' '}
                <strong>{plantingCount} planting{plantingCount !== 1 ? 's' : ''}</strong> assigned to it.
              </p>
              <p className="text-gray-600 text-sm mb-4">
                You can either unassign the plantings (they will become unassigned and can be
                reassigned to another bed later) or cancel.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>Note:</strong> Unassigning plantings will remove their bed assignment.
                You will need to manually reassign them to other beds.
              </div>
            </>
          ) : (
            <p className="text-gray-700">
              Are you sure you want to delete <strong>{bed.name}</strong>?
              This action cannot be undone.
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
          {hasPlantings ? (
            <button
              onClick={() => onAction('unassign')}
              className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700"
            >
              Unassign Plantings & Delete
            </button>
          ) : (
            <button
              onClick={() => onAction('delete')}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Delete Bed
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
