'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { CropBoxDisplayConfig } from '@/lib/entities/plan';
import type { Product } from '@/lib/entities/product';
import type { CropConfig, ProductYield } from '@/lib/entities/crop-config';
import { calculateConfigRevenue } from '@/lib/revenue';
import { buildYieldContext, evaluateYieldFormula } from '@/lib/entities/crop-config';
import { Z_INDEX } from '@/lib/z-index';

// dnd-kit imports
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// =============================================================================
// Types
// =============================================================================

/** Minimal crop data needed for template resolution */
export interface CropForDisplay {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  resource: string;
  category?: string;
  /** Total bed-feet needed - derived from Planting.bedFeet */
  feetNeeded: number;
  cropConfigId?: string;
  totalBeds: number;
  bedIndex: number;
  groupId: string;
  harvestStartDate?: string;
  plantingMethod?: 'direct-seed' | 'transplant' | 'perennial';
  growingStructure?: 'field' | 'greenhouse' | 'high-tunnel';
  sequenceSlot?: number;
}

// =============================================================================
// Token Definitions & Formatting
// =============================================================================

type DataType = 'string' | 'number' | 'date';

interface TokenDef {
  key: string;
  label: string;
  description: string;
  dataType: DataType;
  resolve: (crop: CropForDisplay, context: ResolverContext) => string | number | null;
}

interface ResolverContext {
  cropCatalog?: Record<string, CropConfig>;
  products?: Record<string, Product>;
}

// =============================================================================
// Formatters with Format Specifiers
// =============================================================================

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format date with optional format specifier.
 * Formats: M/D, MM/DD (default), MMM D, MMM DD, YYYY-MM-DD
 */
function formatDate(dateStr: string | null | undefined, format?: string): string {
  if (!dateStr || typeof dateStr !== 'string') return '';

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year: number, month: number, day: number;

  if (match) {
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    day = parseInt(match[3], 10);
  } else {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    year = d.getFullYear();
    month = d.getMonth() + 1;
    day = d.getDate();
  }

  const fmt = format?.toUpperCase() || 'MM/DD';

  switch (fmt) {
    case 'M/D':
      return `${month}/${day}`;
    case 'MM/DD':
      return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    case 'MMM D':
      return `${MONTH_NAMES[month - 1]} ${day}`;
    case 'MMM DD':
      return `${MONTH_NAMES[month - 1]} ${String(day).padStart(2, '0')}`;
    case 'YYYY-MM-DD':
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    case 'MM-DD':
      return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    default:
      // Default to MM/DD
      return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  }
}

/**
 * Format number with optional format specifier.
 * Formats: 0 (default), 1, 2 = decimal places; prefix with , for commas (default on)
 * Examples: "0" = 1234, "2" = 1234.56, ",0" = 1,234, ",2" = 1,234.56, "no," = no commas
 */
function formatNumber(value: number | null | undefined, format?: string): string {
  if (value == null || isNaN(value)) return '';

  let useCommas = true;
  let decimals = 0;

  if (format) {
    // Check for "no," prefix to disable commas
    if (format.startsWith('no,')) {
      useCommas = false;
      format = format.slice(3);
    }
    // Parse decimal places
    const parsed = parseInt(format, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 10) {
      decimals = parsed;
    }
  }

  if (useCommas) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } else {
    return value.toFixed(decimals);
  }
}

/**
 * Format string with optional format specifier.
 * Format is max length of content before truncation. Default: 17
 * If truncated, ellipsis is added after the max length.
 * Use "0" or "none" for no truncation.
 */
function formatString(value: string | null | undefined, format?: string): string {
  if (!value) return '';

  let maxLength = 17;

  if (format) {
    if (format === '0' || format.toLowerCase() === 'none') {
      return value; // No truncation
    }
    const parsed = parseInt(format, 10);
    if (!isNaN(parsed) && parsed > 0) {
      maxLength = parsed;
    }
  }

  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + '…';
}

/** Apply formatting based on data type and optional format specifier */
function applyFormat(value: string | number | null, dataType: DataType, format?: string): string {
  if (value == null) return '';

  switch (dataType) {
    case 'date':
      return formatDate(value as string, format);
    case 'number':
      return formatNumber(typeof value === 'number' ? value : parseFloat(value as string), format);
    case 'string':
    default:
      return formatString(String(value), format);
  }
}

const TOKENS: TokenDef[] = [
  {
    key: 'name',
    label: 'Name',
    description: 'Crop name',
    dataType: 'string',
    resolve: (crop) => crop.name || null,
  },
  {
    key: 'configId',
    label: 'Config ID',
    description: 'Configuration identifier',
    dataType: 'string',
    resolve: (crop) => crop.cropConfigId || null,
  },
  {
    key: 'category',
    label: 'Category',
    description: 'Crop category',
    dataType: 'string',
    resolve: (crop) => crop.category || null,
  },
  {
    key: 'startDate',
    label: 'Start',
    description: 'Field start date',
    dataType: 'date',
    resolve: (crop) => crop.startDate || null,
  },
  {
    key: 'endDate',
    label: 'End',
    description: 'End date',
    dataType: 'date',
    resolve: (crop) => crop.endDate || null,
  },
  {
    key: 'harvestDate',
    label: 'Harvest',
    description: 'Harvest start date',
    dataType: 'date',
    resolve: (crop) => crop.harvestStartDate || null,
  },
  {
    key: 'feet',
    label: 'Feet',
    description: 'Total feet needed',
    dataType: 'number',
    resolve: (crop) => crop.feetNeeded ?? null,
  },
  {
    key: 'revenue',
    label: 'Revenue',
    description: 'Calculated revenue ($)',
    dataType: 'number',
    resolve: (crop, ctx) => {
      if (!ctx.cropCatalog || !ctx.products || !crop.cropConfigId) return null;
      const config = ctx.cropCatalog[crop.cropConfigId];
      if (!config) return null;
      const rev = calculateConfigRevenue(config, crop.feetNeeded, ctx.products);
      return rev ?? null;
    },
  },
  {
    key: 'method',
    label: 'Method',
    description: 'Planting method (DS/TP/PE)',
    dataType: 'string',
    resolve: (crop) => {
      if (!crop.plantingMethod) return null;
      const map: Record<string, string> = {
        'direct-seed': 'DS',
        'transplant': 'TP',
        'perennial': 'PE',
      };
      return map[crop.plantingMethod] || null;
    },
  },
  {
    key: 'bed',
    label: 'Bed',
    description: 'Current bed name',
    dataType: 'string',
    resolve: (crop) => crop.resource || null,
  },
  {
    key: 'beds',
    label: 'Beds',
    description: 'Bed span (e.g., "1/3")',
    dataType: 'string',
    resolve: (crop) => crop.totalBeds > 1 ? `${crop.bedIndex}/${crop.totalBeds}` : null,
  },
  {
    key: 'seq',
    label: 'Seq',
    description: 'Sequence slot (e.g., "S2")',
    dataType: 'string',
    resolve: (crop) => crop.sequenceSlot != null ? `S${crop.sequenceSlot + 1}` : null,
  },
  {
    key: 'structure',
    label: 'Structure',
    description: 'Growing structure (Field/GH/HT)',
    dataType: 'string',
    resolve: (crop) => {
      if (!crop.growingStructure) return null;
      const map: Record<string, string> = {
        'field': 'Field',
        'greenhouse': 'GH',
        'high-tunnel': 'HT',
      };
      return map[crop.growingStructure] || null;
    },
  },
  {
    key: 'yield',
    label: 'Yield',
    description: 'Total yield (from formula)',
    dataType: 'number',
    resolve: (crop, ctx) => {
      if (!ctx.cropCatalog || !crop.cropConfigId) return null;
      const config = ctx.cropCatalog[crop.cropConfigId];
      if (!config?.productYields?.length) return null;

      // Sum yields from all products
      let totalYield = 0;
      for (const py of config.productYields) {
        if (!py.yieldFormula) continue;
        const context = buildYieldContext(config, crop.feetNeeded);
        context.harvests = py.numberOfHarvests ?? 1;
        const result = evaluateYieldFormula(py.yieldFormula, context);
        if (result.value !== null) {
          totalYield += result.value;
        }
      }
      return totalYield > 0 ? totalYield : null;
    },
  },
];

// =============================================================================
// Template Resolver
// =============================================================================

// Matches {token} or {token:format}
const TOKEN_REGEX = /\{(\w+)(?::([^}]*))?\}/g;

export function resolveTemplate(
  template: string,
  crop: CropForDisplay,
  context: ResolverContext
): string {
  return template.replace(TOKEN_REGEX, (match, key, format) => {
    const token = TOKENS.find(t => t.key === key);
    if (!token) return match;
    const rawValue = token.resolve(crop, context);
    return applyFormat(rawValue, token.dataType, format);
  });
}

export const DEFAULT_HEADER_TEMPLATE = '{name}';
export const DEFAULT_DESCRIPTION_TEMPLATE = '{startDate} - {endDate}';

// =============================================================================
// Template Parsing
// =============================================================================

interface TemplateSegment {
  type: 'token' | 'text';
  value: string;
  id: string;
}

let segmentIdCounter = 0;
function generateSegmentId(): string {
  return `seg_${++segmentIdCounter}_${Date.now()}`;
}

function parseTemplate(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  // Match {token} or {token:format}
  const regex = /\{(\w+(?::[^}]*)?)\}/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      const text = template.slice(lastIndex, match.index);
      if (text) {
        segments.push({ type: 'text', value: text, id: generateSegmentId() });
      }
    }
    // Store full token value including format (e.g., "revenue:2")
    segments.push({ type: 'token', value: match[1], id: generateSegmentId() });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < template.length) {
    segments.push({ type: 'text', value: template.slice(lastIndex), id: generateSegmentId() });
  }

  return segments;
}

function segmentsToTemplate(segments: TemplateSegment[]): string {
  return segments
    .map(seg => seg.type === 'token' ? `{${seg.value}}` : seg.value)
    .join('');
}

/** Extract token key from value (handles "revenue:2" -> "revenue") */
function getTokenKey(value: string): string {
  const colonIndex = value.indexOf(':');
  return colonIndex === -1 ? value : value.slice(0, colonIndex);
}

/** Find token definition by value (which may include format specifier) */
function findTokenDef(value: string): TokenDef | undefined {
  return TOKENS.find(t => t.key === getTokenKey(value));
}

// =============================================================================
// Draggable Palette Token
// =============================================================================

function PaletteToken({ tokenKey, onClick }: { tokenKey: string; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${tokenKey}`,
    data: { type: 'palette', tokenKey },
  });

  const token = TOKENS.find(t => t.key === tokenKey);

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={onClick}
      title={token?.description}
      className={`px-2 py-1 text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors cursor-grab active:cursor-grabbing touch-none ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {`{${tokenKey}}`}
    </button>
  );
}

// =============================================================================
// Sortable Token in Line
// =============================================================================

function SortableToken({
  segment,
  onDelete,
}: {
  segment: TemplateSegment;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: segment.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const token = findTokenDef(segment.value);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono rounded touch-none ${
        isDragging ? 'opacity-50 z-10' : ''
      } ${
        token
          ? 'bg-blue-100 text-blue-800 border border-blue-200'
          : 'bg-gray-100 text-gray-600 border border-gray-300'
      }`}
      title={token?.description}
    >
      <span {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        {`{${segment.value}}`}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="text-blue-400 hover:text-red-500 leading-none"
      >
        ×
      </button>
    </div>
  );
}

// =============================================================================
// Token Overlay for Drag
// =============================================================================

function TokenOverlay({ tokenKey }: { tokenKey: string }) {
  return (
    <div className="inline-flex items-center px-2 py-0.5 text-xs font-mono rounded shadow-lg bg-blue-100 text-blue-800 border border-blue-200">
      {`{${tokenKey}}`}
    </div>
  );
}

// =============================================================================
// Droppable Token Line
// =============================================================================

interface TokenLineProps {
  lineId: string;
  segments: TemplateSegment[];
  onSegmentsChange: (segments: TemplateSegment[]) => void;
  placeholder: string;
}

function TokenLine({ lineId, segments, onSegmentsChange, placeholder }: TokenLineProps) {
  const { setNodeRef, isOver } = useDroppable({ id: lineId });
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const handleDeleteToken = (index: number) => {
    const newSegments = [...segments];
    newSegments.splice(index, 1);
    // Clean up adjacent spaces
    if (index > 0 && index < newSegments.length) {
      const prev = newSegments[index - 1];
      const next = newSegments[index];
      if (prev.type === 'text' && next.type === 'text') {
        newSegments[index - 1] = { ...prev, value: prev.value + next.value };
        newSegments.splice(index, 1);
      }
    }
    onSegmentsChange(newSegments);
  };

  const handleTextChange = (index: number, newValue: string) => {
    const newSegments = [...segments];
    newSegments[index] = { ...newSegments[index], value: newValue };
    onSegmentsChange(newSegments);
  };

  const handleTextBlur = (index: number, value: string) => {
    // Remove empty text segments on blur
    if (value === '') {
      const newSegments = [...segments];
      newSegments.splice(index, 1);
      onSegmentsChange(newSegments);
    }
  };

  // Insert a text segment at position and focus it
  const insertTextAt = (position: number) => {
    const newSegments = [...segments];
    const newId = generateSegmentId();
    newSegments.splice(position, 0, { type: 'text', value: '', id: newId });
    onSegmentsChange(newSegments);
    // Focus after React renders
    setTimeout(() => {
      inputRefs.current.get(position)?.focus();
    }, 0);
  };

  // Calculate input width based on content using ch units
  const getInputStyle = (value: string): React.CSSProperties => {
    // Use ch units (width of '0' character) for accurate sizing
    // Add 1ch padding for cursor space
    const width = value.length > 0 ? `${value.length + 1}ch` : '2ch';
    return { width };
  };

  // Show + button at a position only if there's no text segment there
  // i.e., show between adjacent tokens, or at start/end if no text there
  const showInsertAt = (position: number): boolean => {
    // At start: show if first segment is a token (or empty)
    if (position === 0) {
      return segments.length === 0 || segments[0]?.type === 'token';
    }
    // At end: show if last segment is a token
    if (position === segments.length) {
      return segments[segments.length - 1]?.type === 'token';
    }
    // In middle: show only between two tokens
    const before = segments[position - 1];
    const after = segments[position];
    return before?.type === 'token' && after?.type === 'token';
  };

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[32px] px-1 py-1 border rounded-md bg-white flex flex-wrap items-center ${
        isOver ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-300'
      }`}
    >
      {segments.length === 0 && !isOver && (
        <button
          type="button"
          onClick={() => insertTextAt(0)}
          className="text-gray-400 text-sm px-1 hover:text-blue-600"
        >
          {placeholder} <span className="text-xs">+</span>
        </button>
      )}
      {isOver && segments.length === 0 && (
        <span className="text-blue-500 text-sm px-1">Drop here</span>
      )}

      {/* Insert button at start if needed */}
      {segments.length > 0 && showInsertAt(0) && (
        <button
          type="button"
          onClick={() => insertTextAt(0)}
          className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-full text-xs shrink-0 mx-0.5"
          title="Insert text"
        >
          +
        </button>
      )}

      <SortableContext items={segments.map(s => s.id)} strategy={horizontalListSortingStrategy}>
        {segments.map((segment, index) => (
          <div key={segment.id} className="flex items-center">
            {segment.type === 'token' ? (
              <SortableToken
                segment={segment}
                onDelete={() => handleDeleteToken(index)}
              />
            ) : (
              <input
                ref={(el) => {
                  if (el) inputRefs.current.set(index, el);
                  else inputRefs.current.delete(index);
                }}
                type="text"
                value={segment.value}
                onChange={(e) => handleTextChange(index, e.target.value)}
                onBlur={() => handleTextBlur(index, segment.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="py-0.5 px-1.5 text-xs font-mono bg-yellow-50 border border-yellow-300 rounded outline-none focus:bg-yellow-100 focus:border-yellow-400"
                style={getInputStyle(segment.value)}
                placeholder="·"
              />
            )}

            {/* Insert button after token if next is also a token (or end) */}
            {showInsertAt(index + 1) && (
              <button
                type="button"
                onClick={() => insertTextAt(index + 1)}
                className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded-full text-xs shrink-0 mx-0.5"
                title="Insert text"
              >
                +
              </button>
            )}
          </div>
        ))}
      </SortableContext>
    </div>
  );
}

// =============================================================================
// Component Props
// =============================================================================

interface CropBoxDisplayEditorProps {
  isOpen: boolean;
  onClose: () => void;
  config: CropBoxDisplayConfig | undefined;
  onSave: (config: CropBoxDisplayConfig) => void;
  sampleCrops: CropForDisplay[];
  cropCatalog?: Record<string, CropConfig>;
  products?: Record<string, Product>;
}

// =============================================================================
// Main Component
// =============================================================================

export default function CropBoxDisplayEditor({
  isOpen,
  onClose,
  config,
  onSave,
  sampleCrops,
  cropCatalog,
  products,
}: CropBoxDisplayEditorProps) {
  // Store segments directly as source of truth (preserves IDs across edits)
  const [headerSegments, setHeaderSegments] = useState<TemplateSegment[]>(() =>
    parseTemplate(config?.headerTemplate ?? DEFAULT_HEADER_TEMPLATE)
  );
  const [descSegments, setDescSegments] = useState<TemplateSegment[]>(() =>
    parseTemplate(config?.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE)
  );

  // Derive template strings from segments for preview and saving
  const headerTemplate = useMemo(() => segmentsToTemplate(headerSegments), [headerSegments]);
  const descriptionTemplate = useMemo(() => segmentsToTemplate(descSegments), [descSegments]);

  // UI state
  const [selectedCropIndex, setSelectedCropIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'token' | 'text'>('token');
  const [activeInput, setActiveInput] = useState<'header' | 'description'>('header');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Refs for text mode
  const headerInputRef = useRef<HTMLInputElement>(null);
  const descInputRef = useRef<HTMLInputElement>(null);

  // dnd-kit sensor
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setHeaderSegments(parseTemplate(config?.headerTemplate ?? DEFAULT_HEADER_TEMPLATE));
      setDescSegments(parseTemplate(config?.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE));
      setSelectedCropIndex(0);
    }
  }, [isOpen, config]);

  const resolverContext: ResolverContext = { cropCatalog, products };
  const previewCrop = sampleCrops[selectedCropIndex] || sampleCrops[0];

  const previewHeader = useMemo(() => {
    if (!previewCrop) return '';
    return resolveTemplate(headerTemplate, previewCrop, resolverContext);
  }, [headerTemplate, previewCrop, resolverContext]);

  const previewDescription = useMemo(() => {
    if (!previewCrop) return '';
    return resolveTemplate(descriptionTemplate, previewCrop, resolverContext);
  }, [descriptionTemplate, previewCrop, resolverContext]);

  // Segment update handlers - directly update segment state (preserves IDs)
  const handleHeaderSegmentsChange = (newSegments: TemplateSegment[]) => {
    setHeaderSegments(newSegments);
  };

  const handleDescSegmentsChange = (newSegments: TemplateSegment[]) => {
    setDescSegments(newSegments);
  };

  // Click to add token (for both visual and text mode)
  const addTokenToLine = (tokenKey: string, line: 'header' | 'description') => {
    const segments = line === 'header' ? headerSegments : descSegments;
    const setSegments = line === 'header' ? setHeaderSegments : setDescSegments;

    const newSegment: TemplateSegment = {
      type: 'token',
      value: tokenKey,
      id: generateSegmentId(),
    };
    const newSegments = [...segments];

    // Add space before if needed
    if (newSegments.length > 0) {
      const lastSeg = newSegments[newSegments.length - 1];
      if (lastSeg.type === 'token' || (lastSeg.type === 'text' && !lastSeg.value.endsWith(' '))) {
        newSegments.push({ type: 'text', value: ' ', id: generateSegmentId() });
      }
    }
    newSegments.push(newSegment);
    setSegments(newSegments);
  };

  // dnd-kit handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over) return;

    const activeData = active.data.current;
    const overId = over.id as string;

    // Dropping from palette
    if (activeData?.type === 'palette') {
      const tokenKey = activeData.tokenKey;
      if (overId === 'header-line') {
        addTokenToLine(tokenKey, 'header');
      } else if (overId === 'desc-line') {
        addTokenToLine(tokenKey, 'description');
      }
      return;
    }

    // Reordering within header line
    const headerIndex = headerSegments.findIndex(s => s.id === active.id);
    const headerOverIndex = headerSegments.findIndex(s => s.id === over.id);
    if (headerIndex !== -1 && headerOverIndex !== -1 && headerIndex !== headerOverIndex) {
      setHeaderSegments(arrayMove(headerSegments, headerIndex, headerOverIndex));
      return;
    }

    // Reordering within description line
    const descIndex = descSegments.findIndex(s => s.id === active.id);
    const descOverIndex = descSegments.findIndex(s => s.id === over.id);
    if (descIndex !== -1 && descOverIndex !== -1 && descIndex !== descOverIndex) {
      setDescSegments(arrayMove(descSegments, descIndex, descOverIndex));
      return;
    }
  };

  // Get active token key for overlay
  const getActiveTokenKey = (): string | null => {
    if (!activeDragId) return null;
    if (activeDragId.startsWith('palette-')) {
      return activeDragId.replace('palette-', '');
    }
    const segment = [...headerSegments, ...descSegments].find(s => s.id === activeDragId);
    return segment?.type === 'token' ? segment.value : null;
  };

  const handleSave = () => {
    onSave({ headerTemplate, descriptionTemplate });
    onClose();
  };

  const handleReset = () => {
    setHeaderSegments(parseTemplate(DEFAULT_HEADER_TEMPLATE));
    setDescSegments(parseTemplate(DEFAULT_DESCRIPTION_TEMPLATE));
  };

  if (!isOpen) return null;

  // Category colors for preview
  const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
    'Root': { bg: '#ff7043', text: '#fff' },
    'Brassica': { bg: '#66bb6a', text: '#fff' },
    'Green': { bg: '#43a047', text: '#fff' },
    'Herb': { bg: '#7cb342', text: '#fff' },
    'Tomato': { bg: '#ef5350', text: '#fff' },
    'Pepper': { bg: '#ab47bc', text: '#fff' },
    'Cucumber': { bg: '#26a69a', text: '#fff' },
    'Onion': { bg: '#8d6e63', text: '#fff' },
    'Flower': { bg: '#ec407a', text: '#fff' },
  };
  const DEFAULT_COLOR = { bg: '#78909c', text: '#fff' };
  const colors = previewCrop?.category ? (CATEGORY_COLORS[previewCrop.category] || DEFAULT_COLOR) : DEFAULT_COLOR;

  const activeTokenKey = getActiveTokenKey();

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: Z_INDEX.MODAL }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Crop Box Display</h2>
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="w-5 h-5 rounded-full bg-gray-200 text-gray-600 hover:bg-blue-100 hover:text-blue-700 text-xs font-bold flex items-center justify-center"
              title="How to use"
            >
              ?
            </button>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Help Modal */}
        {showHelp && (
          <div className="absolute inset-0 bg-white rounded-lg z-10 flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">How to Use</h2>
              <button
                onClick={() => setShowHelp(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1 text-sm text-gray-700 space-y-4">
              <section>
                <h3 className="font-semibold text-gray-900 mb-1">Overview</h3>
                <p>
                  Customize what information appears in crop boxes on the timeline.
                  Each box has a <strong>header line</strong> (bold) and a <strong>description line</strong> (smaller).
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-gray-900 mb-1">Tokens</h3>
                <p className="mb-2">
                  Tokens are placeholders like <code className="px-1 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{'{name}'}</code> that
                  get replaced with actual crop data. Available tokens:
                </p>
                <ul className="text-xs space-y-1 ml-4">
                  <li><code className="text-blue-700">{'{name}'}</code> - Crop name</li>
                  <li><code className="text-blue-700">{'{startDate}'}</code>, <code className="text-blue-700">{'{endDate}'}</code>, <code className="text-blue-700">{'{harvestDate}'}</code> - Dates (MM/DD)</li>
                  <li><code className="text-blue-700">{'{feet}'}</code> - Total feet needed</li>
                  <li><code className="text-blue-700">{'{revenue}'}</code> - Calculated revenue</li>
                  <li><code className="text-blue-700">{'{method}'}</code> - DS/TP/PE</li>
                  <li><code className="text-blue-700">{'{bed}'}</code> - Current bed name</li>
                  <li><code className="text-blue-700">{'{beds}'}</code> - Bed span (e.g., 1/3)</li>
                  <li><code className="text-blue-700">{'{seq}'}</code> - Sequence slot</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-gray-900 mb-1">Visual Mode</h3>
                <ul className="list-disc ml-4 space-y-1">
                  <li><strong>Add tokens:</strong> Click a token button or drag it to a line</li>
                  <li><strong>Add text:</strong> Click the <span className="inline-flex items-center justify-center w-4 h-4 bg-gray-100 rounded-full text-xs">+</span> button between tokens</li>
                  <li><strong>Reorder:</strong> Drag tokens within a line</li>
                  <li><strong>Remove:</strong> Click the &times; on a token</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-gray-900 mb-1">Text Mode</h3>
                <p>
                  Type templates directly. Use <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">{'{tokenName}'}</code> syntax
                  for tokens, with any text between them.
                </p>
                <p className="mt-1 text-gray-500">
                  Example: <code className="text-xs">{'{name}'} ({'{method}'})</code>
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-gray-900 mb-1">Formatting</h3>
                <p className="mb-2 text-xs">
                  Add <code className="px-1 bg-gray-100 rounded">:format</code> after a token to customize display.
                  Without a format, defaults are applied automatically.
                </p>
                <div className="text-xs space-y-2">
                  <div>
                    <strong>Dates</strong> <span className="text-gray-400">(default: MM/DD)</span>
                    <ul className="ml-4 text-gray-600">
                      <li><code>{'{startDate:M/D}'}</code> → 3/5</li>
                      <li><code>{'{startDate:MM/DD}'}</code> → 03/05</li>
                      <li><code>{'{startDate:MMM D}'}</code> → Mar 5</li>
                      <li><code>{'{startDate:YYYY-MM-DD}'}</code> → 2025-03-05</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Numbers</strong> <span className="text-gray-400">(default: 0 decimals, commas)</span>
                    <ul className="ml-4 text-gray-600">
                      <li><code>{'{revenue:0}'}</code> → 1,234</li>
                      <li><code>{'{revenue:2}'}</code> → 1,234.56</li>
                      <li><code>{'{feet:no,0}'}</code> → 1234 (no commas)</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Text</strong> <span className="text-gray-400">(default: truncate at 17)</span>
                    <ul className="ml-4 text-gray-600">
                      <li><code>{'{name:10}'}</code> → truncate at 10 chars</li>
                      <li><code>{'{name:none}'}</code> → no truncation</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>
            <div className="px-6 py-3 border-t bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="px-6 py-4 space-y-4">
            {/* Token palette */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Available tokens{' '}
                  <span className="text-gray-400 font-normal">
                    ({viewMode === 'token' ? 'drag or click' : 'click'} to add)
                  </span>
                </label>
                {/* View mode toggle */}
                <div className="flex rounded overflow-hidden border border-gray-300">
                  <button
                    type="button"
                    onClick={() => setViewMode('token')}
                    className={`px-2 py-0.5 text-xs font-medium ${
                      viewMode === 'token'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    Visual
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('text')}
                    className={`px-2 py-0.5 text-xs font-medium ${
                      viewMode === 'text'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    Text
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {viewMode === 'token' ? (
                  TOKENS.map((token) => (
                    <PaletteToken
                      key={token.key}
                      tokenKey={token.key}
                      onClick={() => addTokenToLine(token.key, activeInput)}
                    />
                  ))
                ) : (
                  TOKENS.map((token) => (
                    <button
                      key={token.key}
                      type="button"
                      onClick={() => addTokenToLine(token.key, activeInput)}
                      title={token.description}
                      className="px-2 py-1 text-xs font-mono text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                    >
                      {`{${token.key}}`}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Header template */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Header line
              </label>
              {viewMode === 'token' ? (
                <div onFocus={() => setActiveInput('header')}>
                  <TokenLine
                    lineId="header-line"
                    segments={headerSegments}
                    onSegmentsChange={handleHeaderSegmentsChange}
                    placeholder="{name}"
                  />
                </div>
              ) : (
                <input
                  ref={headerInputRef}
                  type="text"
                  value={headerTemplate}
                  onChange={(e) => setHeaderSegments(parseTemplate(e.target.value))}
                  onFocus={() => setActiveInput('header')}
                  className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="{name}"
                />
              )}
            </div>

            {/* Description template */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description line
              </label>
              {viewMode === 'token' ? (
                <div onFocus={() => setActiveInput('description')}>
                  <TokenLine
                    lineId="desc-line"
                    segments={descSegments}
                    onSegmentsChange={handleDescSegmentsChange}
                    placeholder="{startDate} - {endDate}"
                  />
                </div>
              ) : (
                <input
                  ref={descInputRef}
                  type="text"
                  value={descriptionTemplate}
                  onChange={(e) => setDescSegments(parseTemplate(e.target.value))}
                  onFocus={() => setActiveInput('description')}
                  className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="{startDate} - {endDate}"
                />
              )}
            </div>

            {/* Preview section */}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Preview
                </label>
                {sampleCrops.length > 1 && (
                  <select
                    value={selectedCropIndex}
                    onChange={(e) => setSelectedCropIndex(Number(e.target.value))}
                    className="text-xs text-gray-600 border border-gray-300 rounded px-2 py-1"
                  >
                    {sampleCrops.slice(0, 10).map((crop, i) => (
                      <option key={crop.groupId} value={i}>
                        {crop.name} - {crop.resource || 'Unassigned'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Mock crop box */}
              {previewCrop && (
                <div
                  className="rounded shadow-md overflow-hidden"
                  style={{ backgroundColor: colors.bg, color: colors.text, height: 34 }}
                >
                  <div className="flex items-stretch h-full">
                    {/* Method strip */}
                    {previewCrop.plantingMethod && (
                      <div
                        className="shrink-0 flex items-center justify-center text-[8px] font-bold"
                        style={{
                          width: 14,
                          backgroundColor: previewCrop.plantingMethod === 'direct-seed' ? '#854d0e' :
                                          previewCrop.plantingMethod === 'transplant' ? '#166534' : '#7e22ce',
                          color: previewCrop.plantingMethod === 'direct-seed' ? '#fef3c7' :
                                 previewCrop.plantingMethod === 'transplant' ? '#dcfce7' : '#f3e8ff',
                          writingMode: 'vertical-rl',
                          textOrientation: 'mixed',
                          transform: 'rotate(180deg)',
                        }}
                      >
                        {previewCrop.plantingMethod === 'direct-seed' ? 'DS' :
                         previewCrop.plantingMethod === 'transplant' ? 'TP' : 'PE'}
                      </div>
                    )}
                    {/* Badge area */}
                    <div className="flex flex-col items-start gap-0.5 shrink-0 py-1 pl-1" style={{ width: 28 }}>
                      {previewCrop.totalBeds > 1 && (
                        <div
                          className="text-[9px] px-1 rounded font-medium"
                          style={{ backgroundColor: 'rgba(0,0,0,0.2)', color: colors.text }}
                        >
                          {previewCrop.bedIndex}/{previewCrop.totalBeds}
                        </div>
                      )}
                    </div>
                    {/* Main content */}
                    <div className="flex-1 min-w-0 py-1 pr-2">
                      <div className="font-bold text-xs truncate">
                        {previewHeader || <span className="opacity-50">(empty)</span>}
                      </div>
                      <div className="text-[9px] opacity-90 truncate">
                        {previewDescription || <span className="opacity-50">(empty)</span>}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {activeTokenKey && <TokenOverlay tokenKey={activeTokenKey} />}
          </DragOverlay>
        </DndContext>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-between rounded-b-lg">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            Reset to defaults
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
