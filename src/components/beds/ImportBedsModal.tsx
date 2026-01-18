'use client';

import { useState, useCallback, useMemo } from 'react';
import { Z_INDEX } from '@/lib/z-index';

interface ParsedBed {
  name: string;
  group: string;
  length: number;
}

interface ExistingBed {
  id: string;
  name: string;
  groupName: string;
  lengthFt: number;
}

interface ImportBedsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with parsed beds - handler should upsert each one */
  onImport: (beds: ParsedBed[]) => Promise<{ added: number; updated: number; errors: string[] }>;
  existingGroups: string[];
  existingBeds: ExistingBed[];
}

/**
 * Parse CSV text into bed records.
 * - Case-insensitive header matching
 * - Ignores extra columns
 * - Column order doesn't matter
 */
function parseCSV(text: string): { beds: ParsedBed[]; errors: string[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { beds: [], errors: ['CSV must have a header row and at least one data row'] };
  }

  // Parse header - find column indices (case-insensitive)
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase());

  const nameIdx = headers.findIndex(h => ['name', 'bed'].includes(h));
  const groupIdx = headers.findIndex(h => ['group', 'row'].includes(h));
  const lengthIdx = headers.findIndex(h => ['length', 'lengthft', 'length_ft'].includes(h));

  const missingHeaders: string[] = [];
  if (nameIdx === -1) missingHeaders.push('name');
  if (groupIdx === -1) missingHeaders.push('group');
  if (lengthIdx === -1) missingHeaders.push('length');

  if (missingHeaders.length > 0) {
    return { beds: [], errors: [`Missing required columns: ${missingHeaders.join(', ')}`] };
  }

  const beds: ParsedBed[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const values = parseCSVLine(line);
    const rowNum = i + 1;

    const name = values[nameIdx]?.trim();
    const group = values[groupIdx]?.trim();
    const lengthStr = values[lengthIdx]?.trim();

    if (!name) {
      errors.push(`Row ${rowNum}: Missing bed name`);
      continue;
    }
    if (!group) {
      errors.push(`Row ${rowNum}: Missing group name`);
      continue;
    }
    if (!lengthStr) {
      errors.push(`Row ${rowNum}: Missing length`);
      continue;
    }

    const length = parseFloat(lengthStr);
    if (isNaN(length) || length <= 0) {
      errors.push(`Row ${rowNum}: Invalid length "${lengthStr}"`);
      continue;
    }

    beds.push({ name, group, length });
  }

  return { beds, errors };
}

/**
 * Parse a single CSV line, handling quoted values with commas
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);

  return values;
}

export default function ImportBedsModal({
  isOpen,
  onClose,
  onImport,
  existingGroups,
  existingBeds,
}: ImportBedsModalProps) {
  const [csvText, setCSVText] = useState('');
  const [parsedBeds, setParsedBeds] = useState<ParsedBed[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    added: number;
    updated: number;
    errors: string[];
  } | null>(null);
  const [step, setStep] = useState<'input' | 'preview' | 'result'>('input');

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCSVText(text);
    };
    reader.readAsText(file);
  }, []);

  const handleParse = useCallback(() => {
    const { beds, errors } = parseCSV(csvText);
    setParsedBeds(beds);
    setParseErrors(errors);
    if (beds.length > 0) {
      setStep('preview');
    }
  }, [csvText]);

  // Build a lookup for existing beds by name+group (case-insensitive)
  const existingBedLookup = useMemo(() => {
    const lookup = new Map<string, ExistingBed>();
    for (const bed of existingBeds) {
      const key = `${bed.name.toLowerCase()}|${bed.groupName.toLowerCase()}`;
      lookup.set(key, bed);
    }
    return lookup;
  }, [existingBeds]);

  // Categorize parsed beds: new vs update (with length change)
  const { newBeds, updateBeds, unchangedBeds } = useMemo(() => {
    const newBeds: ParsedBed[] = [];
    const updateBeds: { parsed: ParsedBed; existing: ExistingBed }[] = [];
    const unchangedBeds: { parsed: ParsedBed; existing: ExistingBed }[] = [];

    for (const bed of parsedBeds) {
      const key = `${bed.name.toLowerCase()}|${bed.group.toLowerCase()}`;
      const existing = existingBedLookup.get(key);
      if (existing) {
        if (existing.lengthFt !== bed.length) {
          updateBeds.push({ parsed: bed, existing });
        } else {
          unchangedBeds.push({ parsed: bed, existing });
        }
      } else {
        newBeds.push(bed);
      }
    }

    return { newBeds, updateBeds, unchangedBeds };
  }, [parsedBeds, existingBedLookup]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const result = await onImport(parsedBeds);
      setImportResult(result);
      setStep('result');
    } catch (e) {
      setImportResult({
        added: 0,
        updated: 0,
        errors: [e instanceof Error ? e.message : 'Import failed'],
      });
      setStep('result');
    } finally {
      setImporting(false);
    }
  }, [parsedBeds, onImport]);

  const handleClose = () => {
    setCSVText('');
    setParsedBeds([]);
    setParseErrors([]);
    setImportResult(null);
    setStep('input');
    onClose();
  };

  if (!isOpen) return null;

  // Get unique groups from parsed beds that don't exist yet
  const newGroups = [...new Set(parsedBeds.map(b => b.group))].filter(
    g => !existingGroups.some(eg => eg.toLowerCase() === g.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: Z_INDEX.MODAL }}
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Import Beds from CSV</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {step === 'input' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Upload a CSV file or paste CSV data. Required columns:{' '}
                  <code className="bg-gray-100 px-1 rounded">name</code>,{' '}
                  <code className="bg-gray-100 px-1 rounded">group</code>,{' '}
                  <code className="bg-gray-100 px-1 rounded">length</code>
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Existing beds will be updated. New beds will be created.
                </p>
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload CSV file
                </label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              <div className="text-center text-gray-400 text-sm">or paste below</div>

              {/* Text area */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CSV Data</label>
                <textarea
                  value={csvText}
                  onChange={e => setCSVText(e.target.value)}
                  placeholder="name,group,length&#10;A1,Row A,50&#10;A2,Row A,50&#10;B1,Row B,50"
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Parse errors */}
              {parseErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-sm font-medium text-red-800 mb-1">Parse Errors:</p>
                  <ul className="text-sm text-red-700 list-disc list-inside">
                    {parseErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Found <strong>{parsedBeds.length}</strong> beds in{' '}
                  <strong>{[...new Set(parsedBeds.map(b => b.group))].length}</strong> groups
                </p>
                <button
                  onClick={() => setStep('input')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  ← Back to edit
                </button>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
                <p className="text-sm font-medium text-gray-800 mb-1">Import Summary:</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-700">
                    <strong>{newBeds.length}</strong> new
                  </span>
                  <span className="text-blue-700">
                    <strong>{updateBeds.length}</strong> update
                  </span>
                  {unchangedBeds.length > 0 && (
                    <span className="text-gray-500">
                      <strong>{unchangedBeds.length}</strong> unchanged
                    </span>
                  )}
                </div>
              </div>

              {/* New groups notice */}
              {newGroups.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-800">
                    <strong>{newGroups.length}</strong> new group
                    {newGroups.length > 1 ? 's' : ''} will be created: {newGroups.join(', ')}
                  </p>
                </div>
              )}

              {/* Parse warnings */}
              {parseErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-sm font-medium text-red-800 mb-1">
                    Warnings (rows skipped):
                  </p>
                  <ul className="text-sm text-red-700 list-disc list-inside max-h-24 overflow-auto">
                    {parseErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Updates table */}
              {updateBeds.length > 0 && (
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <div className="bg-blue-50 px-3 py-2 border-b border-gray-200">
                    <span className="text-sm font-medium text-blue-800">
                      Beds to update ({updateBeds.length})
                    </span>
                  </div>
                  <div className="max-h-40 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-700">Bed</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-700">Group</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-700">Current</th>
                          <th className="text-center px-3 py-2 font-medium text-gray-700">→</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-700">New</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {updateBeds.map(({ parsed, existing }) => (
                          <tr key={`${parsed.name}|${parsed.group}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{parsed.name}</td>
                            <td className="px-3 py-2 text-gray-600">{parsed.group}</td>
                            <td className="px-3 py-2 text-right">{existing.lengthFt}ft</td>
                            <td className="px-3 py-2 text-center text-gray-400">→</td>
                            <td className="px-3 py-2 text-right font-medium text-blue-700">
                              {parsed.length}ft
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* New beds table */}
              {newBeds.length > 0 && (
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <div className="bg-green-50 px-3 py-2 border-b border-gray-200">
                    <span className="text-sm font-medium text-green-800">
                      New beds ({newBeds.length})
                    </span>
                  </div>
                  <div className="max-h-48 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-700">Name</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-700">Group</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-700">
                            Length (ft)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {newBeds.map((bed, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{bed.name}</td>
                            <td className="px-3 py-2">
                              {bed.group}
                              {newGroups.some(g => g.toLowerCase() === bed.group.toLowerCase()) && (
                                <span className="ml-2 text-xs text-blue-600">(new group)</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">{bed.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'result' && importResult && (
            <div className="space-y-4">
              {(importResult.added > 0 || importResult.updated > 0) && (
                <div className="bg-green-50 border border-green-200 rounded-md p-4">
                  <p className="text-green-800 font-medium">
                    Import complete:
                    {importResult.added > 0 && (
                      <span>
                        {' '}
                        {importResult.added} bed{importResult.added !== 1 ? 's' : ''} added
                      </span>
                    )}
                    {importResult.added > 0 && importResult.updated > 0 && ','}
                    {importResult.updated > 0 && (
                      <span>
                        {' '}
                        {importResult.updated} bed{importResult.updated !== 1 ? 's' : ''} updated
                      </span>
                    )}
                  </p>
                </div>
              )}

              {importResult.added === 0 && importResult.updated === 0 && importResult.errors.length === 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                  <p className="text-gray-600">No changes made - all beds were already up to date.</p>
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                  <p className="text-sm font-medium text-red-800 mb-2">Errors:</p>
                  <ul className="text-sm text-red-700 list-disc list-inside max-h-48 overflow-auto">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          {step === 'input' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleParse}
                disabled={!csvText.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Parse & Preview
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button
                onClick={() => setStep('input')}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={importing || (newBeds.length === 0 && updateBeds.length === 0)}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {importing
                  ? 'Importing...'
                  : `Import ${newBeds.length + updateBeds.length} bed${newBeds.length + updateBeds.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}

          {step === 'result' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
