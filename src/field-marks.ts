export type SpokeId = "name" | "account" | "foundry" | "job";
export type StepMark = "idle" | "open" | "done";

const SPOKE: Record<SpokeId, string> = {
  name: "NAME",
  account: "ACCOUNT",
  foundry: "FOUNDRY",
  job: "JOB",
};

/** An empty step keeps its role word. A typed value replaces that word on the drawing. */
export function spokeLabel(step: SpokeId, value: string): string {
  const clean = value.trim();
  if (!clean) return SPOKE[step];
  return clean.slice(0, 22).toUpperCase();
}

/** A line lights only when the step at that end has been opened or finished. */
export function linkLive(from: string, to: string, marks: Record<string, StepMark>): boolean {
  const live = (id: string) => (marks[id] ?? "idle") !== "idle";
  if (from === "agent") return live(to);
  if (to === "agent") return live(from);
  return live(from) && live(to);
}
