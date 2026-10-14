export type CellPrimitive = string | number | boolean | Date | null;

/**
 * Reduces the shapes exceljs uses for a cell (rich text, hyperlinks,
 * formulas, errors) to a single primitive value.
 */
export function unwrapCell(value: unknown): CellPrimitive {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return null;

  const cell = value as Record<string, unknown>;
  if (Array.isArray(cell.richText)) {
    return (cell.richText as Array<{ text?: unknown }>)
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  if ('hyperlink' in cell && 'text' in cell) return unwrapCell(cell.text);
  if ('formula' in cell || 'sharedFormula' in cell) {
    return unwrapCell(cell.result);
  }
  // Error cells such as #N/A carry no usable value.
  return null;
}

export function isBlankCell(value: unknown): boolean {
  const unwrapped = unwrapCell(value);
  return (
    unwrapped === null ||
    (typeof unwrapped === 'string' && unwrapped.trim() === '')
  );
}

/** Text content of a cell, or null when the cell does not hold text/number. */
export function cellText(value: unknown): string | null {
  const unwrapped = unwrapCell(value);
  if (typeof unwrapped === 'string') return unwrapped.trim();
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) {
    return String(unwrapped);
  }
  return null;
}

/** Lowercase, accent-free, single-spaced form used to match header labels. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
