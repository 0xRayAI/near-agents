function countPhrase(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** Typed name wins. A blank name with saved work shows foundry and gig counts. */
export function drawingLabel(name: string, foundryCount: number, gigCount: number): string {
  const typed = name.trim();
  if (typed) return typed;
  const foundries = Math.max(0, foundryCount);
  const gigs = Math.max(0, gigCount);
  if (foundries === 0 && gigs === 0) return "";
  const foundryPart = countPhrase(foundries, "foundry", "foundries");
  const gigPart = countPhrase(gigs, "gig", "gigs");
  if (foundries === 0) return `${gigPart} saved`;
  if (gigs === 0) return `${foundryPart} saved`;
  return `${foundryPart}, ${gigPart} saved`;
}
