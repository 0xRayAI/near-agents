export type RecordTab = "foundries" | "gigs";
export type GigSide = "opened" | "bought";

export function parseRecordTab(value: string | undefined): RecordTab {
  return value === "gigs" ? "gigs" : "foundries";
}

export function parseGigSide(value: string | undefined): GigSide {
  return value === "bought" ? "bought" : "opened";
}
