'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '@/lib/z-index';

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown in gray */
  secondary?: string;
  /** Group label for organizing options */
  group?: string;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  /** Optional "Add" button at bottom of dropdown */
  onAdd?: () => void;
  /** Label for the add button (default: "Add New") */
  addLabel?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  emptyMessage = 'No matches',
  className = '',
  disabled = false,
  onAdd,
  addLabel = 'Add New',
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  // Get selected option for display
  const selectedOption = useMemo(() => {
    return options.find((o) => o.value === value);
  }, [options, value]);

  // Filter options by search
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.secondary?.toLowerCase().includes(q) ||
        o.group?.toLowerCase().includes(q)
    );
  }, [options, search]);

  // Reset highlight when filtered options change
  useEffect(() => {
    setHighlightIndex(0);
  }, [filteredOptions.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedEl = listRef.current.children[highlightIndex] as HTMLElement;
      highlightedEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, isOpen]);

  // Update dropdown position when opening
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  }, [isOpen]);

  // Close on click outside (check both container and dropdown since dropdown is in a portal)
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideContainer = containerRef.current?.contains(target);
      const isInsideDropdown = dropdownRef.current?.contains(target);
      if (!isInsideContainer && !isInsideDropdown) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch('');
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filteredOptions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredOptions[highlightIndex]) {
          handleSelect(filteredOptions[highlightIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearch('');
        break;
      case 'Tab':
        setIsOpen(false);
        setSearch('');
        break;
    }
  }, [isOpen, filteredOptions, highlightIndex, handleSelect]);

  const handleInputClick = () => {
    if (!disabled) {
      setIsOpen(true);
      // Select all text when clicking on input with existing value
      setTimeout(() => inputRef.current?.select(), 0);
    }
  };

  const renderDropdown = () => {
    if (!isOpen || !dropdownPosition) return null;

    return createPortal(
      <div
        ref={dropdownRef}
        className="fixed bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        style={{
          zIndex: Z_INDEX.TOAST, // Highest level to ensure it appears above all modals
          top: dropdownPosition.top,
          left: dropdownPosition.left,
          width: dropdownPosition.width,
        }}
      >
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500 italic">{emptyMessage}</div>
        ) : (
          <div ref={listRef} className="max-h-60 overflow-auto">
            {filteredOptions.map((option, idx) => (
              <button
                key={option.value}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                  idx === highlightIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                }`}
                onClick={() => handleSelect(option.value)}
                onMouseEnter={() => setHighlightIndex(idx)}
              >
                <span className="truncate flex-1">{option.label}</span>
                {option.secondary && (
                  <span className="text-gray-400 text-xs truncate">{option.secondary}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {onAdd && (
          <>
            <div className="border-t" />
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setSearch('');
                onAdd();
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {addLabel}
            </button>
          </>
        )}
        <div className="px-3 py-1 text-xs text-gray-400 border-t bg-gray-50">
          &uarr;&darr; navigate &middot; Enter select &middot; Esc close
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? search : (selectedOption?.label ?? '')}
        onChange={(e) => setSearch(e.target.value)}
        onClick={handleInputClick}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full px-2 py-1 border rounded text-sm ${
          disabled ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'
        } ${isOpen ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300'}`}
      />
      {!disabled && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      )}
      {renderDropdown()}
    </div>
  );
}

export default SearchableSelect;
