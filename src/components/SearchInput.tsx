'use client';

import React, { useState, useMemo, useEffect, useRef, forwardRef } from 'react';

// =============================================================================
// Types
// =============================================================================

interface AutocompleteSuggestion {
  type: 'sort' | 'sortField' | 'sortDir' | 'filterField';
  value: string;
  display: string;
  full: string;
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Valid sort field names (e.g., ['revenue', 'date', 'bed']) */
  sortFields: string[];
  /** Valid filter field names (e.g., ['bed', 'category', 'crop']). Omit for no field filters. */
  filterFields?: string[];
  /** Tailwind width class (default 'w-48') */
  width?: string;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  sortFields,
  filterFields = [],
  width = 'w-48',
  className = '',
}, forwardedRef) {
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = (forwardedRef as React.RefObject<HTMLInputElement>) || internalRef;
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const SORT_DIRS = ['asc', 'desc'];

  // Generate autocomplete suggestions based on current input
  const autocompleteSuggestions = useMemo((): AutocompleteSuggestion[] => {
    if (!value) return [];

    // Get the last word being typed
    const words = value.split(/\s+/);
    const lastWord = words[words.length - 1].toLowerCase();

    // Check if typing a sort directive (sort: or s: shorthand)
    const isSortPrefix = lastWord.startsWith('sort:') || lastWord.startsWith('s:');
    if (isSortPrefix) {
      const prefixLen = lastWord.startsWith('sort:') ? 5 : 2;
      const afterSort = lastWord.slice(prefixLen);

      // Check if we have a field and are typing direction
      const colonIndex = afterSort.indexOf(':');
      if (colonIndex > 0) {
        // Typing direction (e.g., "s:revenue:")
        const field = afterSort.slice(0, colonIndex);
        const dirPrefix = afterSort.slice(colonIndex + 1);
        return SORT_DIRS
          .filter(d => d.startsWith(dirPrefix))
          .map(d => ({ type: 'sortDir', value: d, display: d, full: `s:${field}:${d}` }));
      } else {
        // Typing field (e.g., "s:" or "s:r")
        return sortFields
          .filter(f => f.startsWith(afterSort))
          .map(f => ({ type: 'sortField', value: f, display: f, full: `s:${f}` }));
      }
    }

    // Check if typing a filter field
    const colonIndex = lastWord.indexOf(':');
    if (colonIndex === -1 && lastWord.length > 0) {
      const suggestions: AutocompleteSuggestion[] = [];

      // Suggest filter fields if provided
      if (filterFields.length > 0) {
        const fieldMatches = filterFields
          .filter(f => f.toLowerCase().startsWith(lastWord))
          .map(f => ({ type: 'filterField' as const, value: f, display: `${f}:`, full: `${f}:` }));
        suggestions.push(...fieldMatches);
      }

      // Also suggest "s:" if it matches
      if ('sort'.startsWith(lastWord) || lastWord === 's') {
        suggestions.unshift({ type: 'sort', value: 's', display: 's:', full: 's:' });
      }

      return suggestions;
    }

    return [];
  }, [value, sortFields, filterFields]);

  // Reset autocomplete index when suggestions change
  useEffect(() => {
    setAutocompleteIndex(0);
  }, [autocompleteSuggestions.length]);

  // Apply the selected autocomplete suggestion
  const applySuggestion = (suggestion: AutocompleteSuggestion) => {
    const words = value.split(/\s+/);
    words[words.length - 1] = suggestion.full;
    // Add colon after sortField to prompt for direction, space after everything else
    const suffix = suggestion.type === 'sortField' ? ':' : ' ';
    onChange(words.join(' ') + suffix);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (autocompleteSuggestions.length > 0) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const suggestion = autocompleteSuggestions[autocompleteIndex];
        if (suggestion) {
          applySuggestion(suggestion);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIndex(i => Math.min(i + 1, autocompleteSuggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Escape') {
        inputRef.current?.blur();
      }
    }
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  // Calculate ghost preview text
  const ghostText = useMemo(() => {
    if (autocompleteSuggestions.length === 0 || !value) return '';
    const suggestion = autocompleteSuggestions[autocompleteIndex];
    if (!suggestion) return '';
    const lastWordLength = value.split(/\s+/).pop()?.length || 0;
    return suggestion.full.slice(lastWordLength);
  }, [autocompleteSuggestions, autocompleteIndex, value]);

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`${width} px-3 py-1 pr-6 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            value
              ? 'border-blue-400 bg-blue-50 text-gray-900'
              : 'border-gray-300 text-gray-900'
          }`}
        />
        {/* Ghost preview of autocomplete */}
        {ghostText && (
          <div className="absolute inset-0 pointer-events-none px-3 py-1 text-sm text-gray-400 overflow-hidden">
            <span className="invisible">{value}</span>
            <span>{ghostText}</span>
          </div>
        )}
        {value && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 z-10"
            title="Clear search"
          >
            &times;
          </button>
        )}
      </div>
      {/* Autocomplete dropdown */}
      {autocompleteSuggestions.length > 0 && (
        <div className={`absolute top-full left-0 mt-1 ${width} bg-white border border-gray-200 rounded shadow-lg z-50 max-h-48 overflow-auto`}>
          {autocompleteSuggestions.map((suggestion, i) => (
            <button
              key={suggestion.full}
              className={`w-full text-left px-3 py-1.5 text-sm ${
                i === autocompleteIndex
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
              onMouseEnter={() => setAutocompleteIndex(i)}
              onClick={() => {
                applySuggestion(suggestion);
                inputRef.current?.focus();
              }}
            >
              <span className="font-mono">{suggestion.display}</span>
              {suggestion.type === 'sortField' && (
                <span className="text-gray-400 text-xs ml-2">sort field</span>
              )}
              {suggestion.type === 'sortDir' && (
                <span className="text-gray-400 text-xs ml-2">direction</span>
              )}
              {suggestion.type === 'filterField' && (
                <span className="text-gray-400 text-xs ml-2">filter</span>
              )}
              {suggestion.type === 'sort' && (
                <span className="text-gray-400 text-xs ml-2">sort prefix</span>
              )}
            </button>
          ))}
          <div className="px-3 py-1 text-xs text-gray-400 border-t">
            Tab to complete &middot; &uarr;&darr; to navigate
          </div>
        </div>
      )}
    </div>
  );
});
