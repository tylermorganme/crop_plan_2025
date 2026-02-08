'use client';

import React, { useState, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Known tag values for ghost-text completion and dropdown suggestions */
  suggestions?: string[];
  placeholder?: string;
  className?: string;
  /** Smaller styling for table cells */
  compact?: boolean;
}

export function TagInput({
  tags,
  onChange,
  suggestions = [],
  placeholder = 'Add tag…',
  className = '',
  compact = false,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [ghostActive, setGhostActive] = useState(true);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({ display: 'none' });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter suggestions: prefix match, exclude already-added tags
  const filteredSuggestions = useMemo(() => {
    const existing = new Set(tags.map(t => t.toLowerCase()));
    const available = suggestions.filter(s => !existing.has(s.toLowerCase()));
    if (!inputValue) return available;
    const lower = inputValue.toLowerCase();
    return available.filter(s => s.toLowerCase().startsWith(lower));
  }, [suggestions, tags, inputValue]);

  // Ghost text = completion portion of first match
  const ghostText = useMemo(() => {
    if (!ghostActive || !inputValue || filteredSuggestions.length === 0) return '';
    const match = filteredSuggestions[0];
    if (!match.toLowerCase().startsWith(inputValue.toLowerCase())) return '';
    return match.slice(inputValue.length);
  }, [ghostActive, inputValue, filteredSuggestions]);

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    // Deduplicate (case-insensitive check)
    if (tags.some(t => t.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...tags, trimmed]);
    setInputValue('');
    setGhostActive(true);
  }, [tags, onChange]);

  const removeTag = useCallback((index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  }, [tags, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && ghostText) {
      e.preventDefault();
      addTag(inputValue + ghostText);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ghostText && ghostActive) {
        addTag(inputValue + ghostText);
      } else if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === ',' || e.key === ';') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setInputValue('');
      setGhostActive(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setGhostActive(true);
    setIsOpen(true);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!listRef.current?.contains(document.activeElement)) {
        // Commit any typed text as a tag on blur
        if (inputValue.trim()) {
          addTag(inputValue);
        }
        setIsOpen(false);
      }
    }, 100);
  };

  const handleFocus = () => {
    setIsOpen(true);
    setGhostActive(true);
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  // Position dropdown below the container
  useLayoutEffect(() => {
    if (isOpen && filteredSuggestions.length > 0 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 120),
        zIndex: 9999,
      });
    } else {
      setDropdownStyle({ display: 'none' });
    }
  }, [isOpen, filteredSuggestions.length]);

  const chipSize = compact
    ? 'px-1.5 py-0 text-xs'
    : 'px-2 py-0.5 text-xs';

  const containerClass = compact
    ? `flex flex-wrap items-center gap-1 w-full min-h-[26px] px-1 py-0.5 border border-gray-300 rounded bg-white text-sm cursor-text ${className}`
    : `flex flex-wrap items-center gap-1 w-full min-h-[34px] px-2 py-1 border border-gray-300 rounded-md bg-white text-sm cursor-text focus-within:ring-2 focus-within:ring-blue-500 ${className}`;

  return (
    <div
      ref={containerRef}
      className={containerClass}
      onClick={handleContainerClick}
    >
      {/* Tag chips */}
      {tags.map((tag, i) => (
        <span
          key={tag}
          className={`inline-flex items-center gap-0.5 bg-blue-100 text-blue-800 rounded-full ${chipSize} whitespace-nowrap`}
        >
          {tag}
          <button
            type="button"
            className="ml-0.5 text-blue-500 hover:text-blue-700 leading-none"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(i);
            }}
            tabIndex={-1}
          >
            ×
          </button>
        </span>
      ))}

      {/* Input with ghost text */}
      <div className="relative flex-1 min-w-[60px]">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="w-full bg-transparent outline-none text-sm"
          autoComplete="off"
          onClick={(e) => e.stopPropagation()}
        />
        {ghostText && (
          <div className="absolute inset-0 pointer-events-none flex items-center text-sm overflow-hidden">
            <span className="invisible">{inputValue}</span>
            <span className="text-gray-400">{ghostText}</span>
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && filteredSuggestions.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          style={dropdownStyle}
          className="max-h-40 overflow-auto bg-white border border-gray-300 rounded shadow-lg"
        >
          {filteredSuggestions.map((opt, idx) => (
            <div
              key={opt}
              className={`px-2 py-1 text-sm cursor-pointer ${
                idx === 0 ? 'bg-blue-100' : 'hover:bg-gray-100'
              }`}
              onMouseDown={() => {
                addTag(opt);
                inputRef.current?.focus();
              }}
            >
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
