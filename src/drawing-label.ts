/** Typed name wins. A blank name with saved work shows the count, so the drawing is not only UNNAMED. */
export function drawingLabel(name: string, savedCount: number): string {
  const typed = name.trim();
  if (typed) return typed;
  if (savedCount > 0) return `${savedCount} saved`;
  return "";
}
