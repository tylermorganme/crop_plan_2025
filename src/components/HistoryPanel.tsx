'use client';

import { useState, useEffect, useCallback } from 'react';
import type { HistoryEntry, Checkpoint } from '@/lib/plan-types';
import {
  getHistory,
  createCheckpoint,
  deleteCheckpoint,
  restoreFromHistory,
} from '@/lib/plan-store';
import { Z_INDEX } from '@/lib/z-index';

interface HistoryPanelProps {
  planId: string;
  isOpen: boolean;
  onClose: () => void;
  onRestore: (message: string) => void;
  onError: (message: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  return 'Just now';
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HistoryPanel({
  planId,
  isOpen,
  onClose,
  onRestore,
  onError,
}: HistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpointDescription, setCheckpointDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    checkpoints: true,
    autoSaves: true,
    recovery: false,
  });
  // Track which item is pending confirmation (inline instead of browser popup)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [confirmingRestoreId, setConfirmingRestoreId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await getHistory(planId);
      setHistory(entries);
    } catch (e) {
      console.error('Failed to load history:', e);
    }
    setLoading(false);
  }, [planId]);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, loadHistory]);

  const handleCreateCheckpoint = async () => {
    if (!checkpointName.trim()) return;

    setIsCreating(true);
    try {
      await createCheckpoint(checkpointName.trim(), checkpointDescription.trim() || undefined);
      setCheckpointName('');
      setCheckpointDescription('');
      await loadHistory();
    } catch (e) {
      onError(`Failed to create checkpoint: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
    setIsCreating(false);
  };

  const handleDeleteCheckpoint = async (checkpointId: string) => {
    try {
      await deleteCheckpoint(checkpointId, planId);
      setConfirmingDeleteId(null);
      await loadHistory();
    } catch (e) {
      onError(`Failed to delete checkpoint: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const handleRestore = async (entry: HistoryEntry) => {
    try {
      await restoreFromHistory(entry);
      setConfirmingRestoreId(null);
      onRestore(`Restored to "${entry.name}"`);
      onClose();
    } catch (e) {
      onError(`Failed to restore: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Split history by type
  const checkpoints = history.filter(h => h.type === 'checkpoint');
  const autoSaves = history.filter(h => h.type === 'auto-save');
  const recovery = history.filter(h => h.type === 'stash');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex justify-end" style={{ zIndex: Z_INDEX.PANEL }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-96 bg-white shadow-xl flex flex-col max-h-full">
        {/* Header */}
        <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">History</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Create Checkpoint Form */}
          <div className="p-4 border-b bg-blue-50">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Create Checkpoint</h3>
            <div className="mb-2">
              <label className="block text-xs font-medium text-gray-800 mb-1">Name</label>
              <input
                type="text"
                value={checkpointName}
                onChange={(e) => setCheckpointName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCheckpoint()}
                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-800 mb-1">Description (optional)</label>
              <input
                type="text"
                value={checkpointDescription}
                onChange={(e) => setCheckpointDescription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCheckpoint()}
                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleCreateCheckpoint}
              disabled={!checkpointName.trim() || isCreating}
              className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? 'Creating...' : 'Save Checkpoint'}
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-600">Loading history...</div>
          ) : (
            <>
              {/* Checkpoints Section */}
              <div className="border-b">
                <button
                  onClick={() => toggleSection('checkpoints')}
                  className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
                >
                  <span>CHECKPOINTS ({checkpoints.length})</span>
                  <span>{expandedSections.checkpoints ? '▼' : '▶'}</span>
                </button>
                {expandedSections.checkpoints && (
                  <div className="divide-y">
                    {checkpoints.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-600 italic">
                        No checkpoints yet
                      </div>
                    ) : (
                      checkpoints.map((entry) => (
                        <HistoryItem
                          key={entry.id}
                          entry={entry}
                          onRestore={() => handleRestore(entry)}
                          onDelete={() => handleDeleteCheckpoint(entry.id)}
                          isConfirmingRestore={confirmingRestoreId === entry.id}
                          isConfirmingDelete={confirmingDeleteId === entry.id}
                          onStartConfirmRestore={() => setConfirmingRestoreId(entry.id)}
                          onStartConfirmDelete={() => setConfirmingDeleteId(entry.id)}
                          onCancelConfirm={() => { setConfirmingRestoreId(null); setConfirmingDeleteId(null); }}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Auto-saves Section */}
              <div className="border-b">
                <button
                  onClick={() => toggleSection('autoSaves')}
                  className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
                >
                  <span>AUTO-SAVES ({autoSaves.length})</span>
                  <span>{expandedSections.autoSaves ? '▼' : '▶'}</span>
                </button>
                {expandedSections.autoSaves && (
                  <div className="divide-y">
                    {autoSaves.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-600 italic">
                        No auto-saves yet
                      </div>
                    ) : (
                      autoSaves.map((entry) => (
                        <HistoryItem
                          key={entry.id}
                          entry={entry}
                          onRestore={() => handleRestore(entry)}
                          isConfirmingRestore={confirmingRestoreId === entry.id}
                          isConfirmingDelete={false}
                          onStartConfirmRestore={() => setConfirmingRestoreId(entry.id)}
                          onCancelConfirm={() => setConfirmingRestoreId(null)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Recovery Section */}
              <div>
                <button
                  onClick={() => toggleSection('recovery')}
                  className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
                >
                  <span>RECOVERY ({recovery.length})</span>
                  <span>{expandedSections.recovery ? '▼' : '▶'}</span>
                </button>
                {expandedSections.recovery && (
                  <div className="divide-y">
                    {recovery.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-600 italic">
                        No recovery points
                      </div>
                    ) : (
                      recovery.map((entry) => (
                        <HistoryItem
                          key={entry.id}
                          entry={entry}
                          onRestore={() => handleRestore(entry)}
                          isConfirmingRestore={confirmingRestoreId === entry.id}
                          isConfirmingDelete={false}
                          onStartConfirmRestore={() => setConfirmingRestoreId(entry.id)}
                          onCancelConfirm={() => setConfirmingRestoreId(null)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Individual history item component
function HistoryItem({
  entry,
  onRestore,
  onDelete,
  isConfirmingRestore,
  isConfirmingDelete,
  onStartConfirmRestore,
  onStartConfirmDelete,
  onCancelConfirm,
}: {
  entry: HistoryEntry;
  onRestore: () => void;
  onDelete?: () => void;
  isConfirmingRestore: boolean;
  isConfirmingDelete: boolean;
  onStartConfirmRestore: () => void;
  onStartConfirmDelete?: () => void;
  onCancelConfirm: () => void;
}) {
  const icon = entry.type === 'checkpoint' ? '★' : entry.type === 'auto-save' ? '○' : '↩';
  const iconColor = entry.type === 'checkpoint' ? 'text-amber-500' : entry.type === 'auto-save' ? 'text-gray-400' : 'text-blue-500';

  return (
    <div className="px-4 py-3 hover:bg-gray-50">
      <div className="flex items-start gap-2">
        <span className={`text-lg ${iconColor}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">{entry.name}</div>
          <div className="text-xs text-gray-600 flex items-center gap-2">
            <span>{formatRelativeTime(entry.timestamp)}</span>
            <span className="text-gray-300">·</span>
            <span>{formatDateTime(entry.timestamp)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 ml-6">
        {isConfirmingRestore ? (
          <>
            <span className="text-xs text-gray-600">Restore this?</span>
            <button
              onClick={onRestore}
              className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded"
            >
              Yes
            </button>
            <button
              onClick={onCancelConfirm}
              className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
          </>
        ) : isConfirmingDelete ? (
          <>
            <span className="text-xs text-gray-600">Delete?</span>
            <button
              onClick={onDelete}
              className="px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded"
            >
              Yes
            </button>
            <button
              onClick={onCancelConfirm}
              className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onStartConfirmRestore}
              className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
            >
              Restore
            </button>
            {onDelete && onStartConfirmDelete && (
              <button
                onClick={onStartConfirmDelete}
                className="px-2 py-1 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
