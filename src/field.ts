export interface FieldNode {
  id: string;
  x: number;
  y: number;
  r: number;
  label: string;
  agent: boolean;
}

interface Placed extends FieldNode {
  px: number;
  py: number;
}

type Dir = "left" | "right" | "up" | "down";

export type StepMark = "idle" | "open" | "done";

const LINKS: Array<[string, string]> = [
  ["agent", "name"],
  ["agent", "account"],
  ["agent", "foundry"],
  ["agent", "job"],
  ["name", "account"],
  ["account", "foundry"],
  ["foundry", "job"],
  ["job", "name"],
];

function seedNodes(): FieldNode[] {
  return [
    { id: "agent", x: 0.5, y: 0.5, r: 28, label: "UNNAMED", agent: true },
    { id: "name", x: 0.5, y: 0.24, r: 16, label: "NAME", agent: false },
    { id: "account", x: 0.74, y: 0.5, r: 16, label: "ACCOUNT", agent: false },
    { id: "foundry", x: 0.5, y: 0.76, r: 16, label: "FOUNDRY", agent: false },
    { id: "job", x: 0.26, y: 0.5, r: 16, label: "JOB", agent: false },
  ];
}

function stamp(text: string): string {
  const clean = text.trim();
  if (!clean) return "UNNAMED";
  return clean.slice(0, 22).toUpperCase();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export class FieldView {
  private nodes: FieldNode[] = seedNodes();
  private placed: Placed[] = [];
  private focus = 0;
  private pointer = { x: 0, y: 0, inside: false };
  private drag: { id: string; ox: number; oy: number } | null = null;
  private dragMoved = false;
  private tighten = 0;
  private locked = false;
  private marks: Record<string, StepMark> = {};
  private reduced: boolean;
  private raf = 0;
  private scale = 1;
  private vw = 0;
  private vh = 0;
  private pal: Record<string, string> = {};
  private readonly media: MediaQueryList;
  private readonly onPick: (id: string) => void;
  private readonly sheetWatch = new MutationObserver(() => {
    this.readPalette();
    this.draw(performance.now());
  });

  private readPalette(): void {
    const cs = getComputedStyle(document.documentElement);
    const names = [
      "--sheet-bg",
      "--sheet-grid",
      "--sheet-grid-major",
      "--sheet-glow",
      "--sheet-glow-mid",
      "--sheet-glow-far",
      "--sheet-vignette",
      "--sheet-vignette-0",
      "--link-idle",
      "--link-hot",
      "--link-locked",
      "--node-fill",
      "--node-idle",
      "--node-open",
      "--node-done",
      "--node-ring",
      "--node-core",
      "--node-core-open",
      "--node-core-done",
      "--agent-ring",
      "--agent-ring-locked",
      "--center-line",
      "--label-ink",
      "--label-open",
      "--label-done",
      "--label-idle",
      "--label-break",
      "--accent",
    ];
    const next: Record<string, string> = {};
    for (const name of names) next[name] = cs.getPropertyValue(name).trim() || "#000000";
    this.pal = next;
  }

  private color(name: string): string {
    return this.pal[name] ?? "#000000";
  }

  constructor(
    private canvas: HTMLCanvasElement,
    options?: { onPick?: (id: string) => void },
  ) {
    this.onPick = options?.onPick ?? (() => undefined);
    this.media = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.media.matches;
    this.media.addEventListener("change", () => {
      this.reduced = this.media.matches;
      if (this.reduced) this.stop();
      else this.start();
      this.draw(0);
    });
    this.bind();
    this.readPalette();
    void document.fonts.ready.then(() => {
      this.readPalette();
      this.draw(0);
    });
    this.draw(0);
    if (!this.reduced) this.start();
  }

  focusedLabel(): string {
    return this.nodes[this.focus]?.label ?? "";
  }

  setAgentLabel(text: string): void {
    const node = this.nodes.find((item) => item.agent);
    if (!node) return;
    const next = stamp(text);
    if (node.label === next) return;
    node.label = next;
    if (this.reduced) this.draw(0);
  }

  setTighten(amount: number): void {
    this.tighten = clamp(amount, 0, 1);
    if (this.reduced) this.draw(0);
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (this.reduced) this.draw(0);
  }

  setSteps(marks: Record<string, StepMark>): void {
    this.marks = marks;
    if (this.reduced) this.draw(0);
  }

  moveFocus(dir: Dir): string {
    const origin = this.nodes[this.focus];
    if (!origin) return "";
    let best = -1;
    let bestScore = Infinity;
    this.nodes.forEach((node, index) => {
      if (index === this.focus) return;
      const dx = node.x - origin.x;
      const dy = node.y - origin.y;
      if (dir === "left" && dx >= -0.02) return;
      if (dir === "right" && dx <= 0.02) return;
      if (dir === "up" && dy >= -0.02) return;
      if (dir === "down" && dy <= 0.02) return;
      const primary = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
      const secondary = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 1.6;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best >= 0) this.focus = best;
    if (this.reduced) this.draw(0);
    return this.focusedLabel();
  }

  private start(): void {
    if (this.reduced) return;
    cancelAnimationFrame(this.raf);
    const loop = (time: number) => {
      this.draw(time);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private bind(): void {
    this.sheetWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-sheet"],
    });
    const resize = new ResizeObserver(() => this.draw(performance.now()));
    resize.observe(this.canvas);

    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.canvas.focus();
      const point = this.local(event);
      this.pointer = { x: point.x, y: point.y, inside: true };
      this.dragMoved = false;
      this.canvas.style.touchAction = "none";
      const hit = this.hit(point.x, point.y);
      if (hit && point.w > 0 && point.h > 0) {
        const node = this.nodes.find((item) => item.id === hit.id);
        const index = this.nodes.findIndex((item) => item.id === hit.id);
        if (node && index >= 0) {
          node.x = clamp(hit.px / point.w, 0.06, 0.94);
          node.y = clamp(hit.py / point.h, 0.08, 0.92);
          this.focus = index;
          this.drag = { id: hit.id, ox: point.x - hit.px, oy: point.y - hit.py };
          this.canvas.setPointerCapture(event.pointerId);
        }
      }
      this.draw(performance.now());
    });

    this.canvas.addEventListener("pointermove", (event) => {
      const point = this.local(event);
      this.pointer = { x: point.x, y: point.y, inside: true };
      if (this.drag && point.w > 0 && point.h > 0) {
        const node = this.nodes.find((item) => item.id === this.drag?.id);
        if (node) {
          const nextX = clamp((point.x - this.drag.ox) / point.w, 0.06, 0.94);
          const nextY = clamp((point.y - this.drag.oy) / point.h, 0.08, 0.92);
          if (Math.abs(nextX - node.x) > 0.01 || Math.abs(nextY - node.y) > 0.01) {
            this.dragMoved = true;
          }
          node.x = nextX;
          node.y = nextY;
        }
      }
      if (this.reduced) this.draw(0);
    });

    const release = (event: PointerEvent) => {
      const picked = this.drag && !this.dragMoved ? this.drag.id : "";
      if (this.drag) this.drag = null;
      this.canvas.style.touchAction = "pan-y";
      if (picked) this.onPick(picked);
      const point = this.local(event);
      const rect = this.canvas.getBoundingClientRect();
      const inside =
        point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height;
      this.pointer.inside = inside;
      if (this.reduced) this.draw(0);
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.pointer.inside = false;
      if (this.reduced) this.draw(0);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
      else if (!this.reduced) this.start();
    });
  }

  private local(event: PointerEvent): { x: number; y: number; w: number; h: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
  }

  private hit(x: number, y: number): Placed | null {
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const node of this.placed) {
      const distance = Math.hypot(node.px - x, node.py - y);
      const reach = node.r + 14;
      if (distance <= reach && distance < bestD) {
        best = node;
        bestD = distance;
      }
    }
    return best;
  }

  private draw(time: number): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const width = Math.floor(w * dpr);
    const height = Math.floor(h * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = w;
    this.vh = h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.color("--sheet-bg");
    ctx.fillRect(0, 0, w, h);

    const leanX = !this.reduced && this.pointer.inside ? (this.pointer.x / w - 0.5) * 10 : 0;
    const leanY = !this.reduced && this.pointer.inside ? (this.pointer.y / h - 0.5) * 8 : 0;
    const gap = 21;
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.color("--sheet-grid");
    ctx.beginPath();
    for (let x = -gap, i = 0; x <= w + gap; x += gap, i += 1) {
      if (i % 4 === 0) continue;
      ctx.moveTo(x + leanX, -gap);
      ctx.lineTo(x + leanX, h + gap);
    }
    for (let y = -gap, i = 0; y <= h + gap; y += gap, i += 1) {
      if (i % 4 === 0) continue;
      ctx.moveTo(-gap, y + leanY);
      ctx.lineTo(w + gap, y + leanY);
    }
    ctx.stroke();
    ctx.strokeStyle = this.color("--sheet-grid-major");
    ctx.beginPath();
    for (let x = -gap, i = 0; x <= w + gap; x += gap, i += 1) {
      if (i % 4 !== 0) continue;
      ctx.moveTo(x + leanX, -gap);
      ctx.lineTo(x + leanX, h + gap);
    }
    for (let y = -gap, i = 0; y <= h + gap; y += gap, i += 1) {
      if (i % 4 !== 0) continue;
      ctx.moveTo(-gap, y + leanY);
      ctx.lineTo(w + gap, y + leanY);
    }
    ctx.stroke();

    if (this.pointer.inside) {
      const radius = Math.min(w, h) * 0.45;
      const glow = ctx.createRadialGradient(
        this.pointer.x,
        this.pointer.y,
        0,
        this.pointer.x,
        this.pointer.y,
        radius,
      );
      glow.addColorStop(0, this.color("--sheet-glow"));
      glow.addColorStop(0.45, this.color("--sheet-glow-mid"));
      glow.addColorStop(1, this.color("--sheet-glow-far"));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }

    const shade = ctx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      Math.min(w, h) * 0.15,
      w * 0.5,
      h * 0.48,
      Math.max(w, h) * 0.72,
    );
    shade.addColorStop(0, this.color("--sheet-vignette-0"));
    shade.addColorStop(1, this.color("--sheet-vignette"));
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);

    const tighten = this.reduced ? 0 : this.tighten;
    const scale = Math.min(1.25, Math.max(0.72, Math.min(w, h) / 420));
    this.scale = scale;
    this.placed = this.nodes.map((node) => {
      let x = node.x * w;
      let y = node.y * h;
      const dragging = this.drag?.id === node.id;
      if (!this.reduced && !dragging) {
        x += Math.sin(time * 0.001 + node.x * 12) * 3.2 * scale;
        y += Math.cos(time * 0.0012 + node.y * 10) * 2.4 * scale;
      }
      if (tighten > 0 && !dragging) {
        x += (w * 0.5 - x) * tighten * 0.2;
        y += (h * 0.54 - y) * tighten * 0.2;
      }
      return { ...node, px: x, py: y, r: node.r * scale };
    });

    const byId = new Map(this.placed.map((node) => [node.id, node]));
    for (const [left, right] of LINKS) {
      const a = byId.get(left);
      const b = byId.get(right);
      if (!a || !b) continue;
      const markA = this.marks[a.id] ?? "idle";
      const markB = this.marks[b.id] ?? "idle";
      const hot = a.agent || b.agent || markA !== "idle" || markB !== "idle";
      ctx.beginPath();
      ctx.moveTo(a.px, a.py);
      ctx.lineTo(b.px, b.py);
      ctx.strokeStyle = hot
        ? this.locked
          ? this.color("--link-locked")
          : this.color("--link-hot")
        : this.color("--link-idle");
      ctx.lineWidth = hot ? 1.4 : 1;
      ctx.setLineDash(hot ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const node of this.placed) this.drawNode(ctx, node);
    for (const node of this.placed) this.drawLabel(ctx, node);
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: Placed): void {
    const focused = this.nodes[this.focus]?.id === node.id;
    ctx.save();
    ctx.translate(node.px, node.py);
    if (node.agent) {
      ctx.beginPath();
      ctx.arc(0, 0, node.r + 10, 0, Math.PI * 2);
      ctx.strokeStyle = this.locked
        ? this.color("--agent-ring-locked")
        : this.color("--agent-ring");
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([9, 4, 2, 4]);
      ctx.strokeStyle = this.color("--center-line");
      ctx.lineWidth = 1;
      ctx.moveTo(-(node.r + 26), 0);
      ctx.lineTo(node.r + 26, 0);
      ctx.moveTo(0, -(node.r + 26));
      ctx.lineTo(0, node.r + 26);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(0, 0, node.r, 0, Math.PI * 2);
    ctx.fillStyle = this.color("--node-fill");
    ctx.fill();
    const mark = this.marks[node.id] ?? "idle";
    ctx.lineWidth = node.agent || mark === "open" ? 2 : 1.25;
    if (node.agent && this.locked) ctx.strokeStyle = this.color("--node-done");
    else if (node.agent || mark === "open") ctx.strokeStyle = this.color("--node-open");
    else if (mark === "done") ctx.strokeStyle = this.color("--node-done");
    else ctx.strokeStyle = this.color("--node-idle");
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(4, node.r - 6), 0, Math.PI * 2);
    ctx.strokeStyle = this.color("--node-ring");
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, node.agent ? 4 : 2.4, 0, Math.PI * 2);
    if (node.agent) ctx.fillStyle = this.locked ? this.color("--node-core-done") : this.color("--node-core-open");
    else if (mark === "open") ctx.fillStyle = this.color("--node-core-open");
    else if (mark === "done") ctx.fillStyle = this.color("--node-core-done");
    else ctx.fillStyle = this.color("--node-core");
    ctx.fill();
    if (focused) {
      const size = node.r + 8;
      const arm = 7;
      ctx.strokeStyle = this.color("--accent");
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-size, -size + arm);
      ctx.lineTo(-size, -size);
      ctx.lineTo(-size + arm, -size);
      ctx.moveTo(size - arm, -size);
      ctx.lineTo(size, -size);
      ctx.lineTo(size, -size + arm);
      ctx.moveTo(-size, size - arm);
      ctx.lineTo(-size, size);
      ctx.lineTo(-size + arm, size);
      ctx.moveTo(size - arm, size);
      ctx.lineTo(size, size);
      ctx.lineTo(size, size - arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLabel(ctx: CanvasRenderingContext2D, node: Placed): void {
    const px = Math.round(13 * this.scale);
    const ps = Math.round(12 * this.scale);
    ctx.font = node.agent
      ? `600 ${px}px 'IBM Plex Mono', ui-monospace, monospace`
      : `500 ${ps}px 'IBM Plex Mono', ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const agent = this.placed.find((item) => item.agent);
    let dx = 0;
    let dy = 1;
    if (agent && !node.agent) {
      const vx = node.px - agent.px;
      const vy = node.py - agent.py;
      const len = Math.hypot(vx, vy) || 1;
      dx = vx / len;
      dy = vy / len;
    }
    const off = node.r + (node.agent ? 20 : 12) * this.scale;
    const mark = this.marks[node.id] ?? "idle";
    const span = ctx.measureText(node.label).width;
    const box = Math.round(17 * this.scale);
    const half = Math.abs(dx) * (span / 2 + 4) + Math.abs(dy) * (box / 2);
    let cx = node.px + dx * (off + half + 3);
    let cy = node.py + dy * (off + half + 3);
    cx = Math.min(Math.max(cx, span / 2 + 6), this.vw - span / 2 - 6);
    cy = Math.min(Math.max(cy, box / 2 + 3), this.vh - box / 2 - 3);
    ctx.fillStyle = this.color("--label-break");
    ctx.fillRect(cx - span / 2 - 4, cy - box / 2, span + 8, box);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillText(node.label, cx + 1, cy + 1);
    if (node.agent) ctx.fillStyle = this.color("--label-ink");
    else if (mark === "open") ctx.fillStyle = this.color("--label-open");
    else if (mark === "done") ctx.fillStyle = this.color("--label-done");
    else ctx.fillStyle = this.color("--label-idle");
    ctx.fillText(node.label, cx, cy);
  }
}
