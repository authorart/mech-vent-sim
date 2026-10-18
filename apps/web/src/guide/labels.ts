/**
 * Place event labels above a trace without overlap: each label goes in the first row where it
 * doesn't touch the previous label in that row. Returns the row index for each label, in input
 * order (labels must be sorted by x).
 */
export function labelRows(
  labels: { x: number; width: number }[],
  maxRows = 3,
  gap = 4,
): number[] {
  const rowEnd: number[] = [];
  return labels.map(({ x, width }) => {
    const left = x - width / 2;
    let row = rowEnd.findIndex((end) => left >= end + gap);
    if (row === -1) row = rowEnd.length < maxRows ? rowEnd.length : rowEnd.indexOf(Math.min(...rowEnd));
    rowEnd[row] = x + width / 2;
    return row;
  });
}

/** Approximate width of a label in an 11px UI font (SVG has no measureText before layout). */
export function labelWidth(text: string, fontSize = 11): number {
  return text.length * fontSize * 0.58 + 6;
}
