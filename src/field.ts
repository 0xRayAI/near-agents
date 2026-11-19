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
  private readonly media: MediaQueryList;
  private readonly onPick: (id: string) => void;

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
    void document.fonts.ready.then(() => this.draw(0));
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
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#04060c";
    ctx.fillRect(0, 0, w, h);

    const leanX = !this.reduced && this.pointer.inside ? (this.pointer.x / w - 0.5) * 10 : 0;
    const leanY = !this.reduced && this.pointer.inside ? (this.pointer.y / h - 0.5) * 8 : 0;
    ctx.strokeStyle = "rgba(22, 78, 88, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gap = 42;
    for (let x = -gap; x <= w + gap; x += gap) {
      ctx.moveTo(x + leanX, -gap);
      ctx.lineTo(x + leanX, h + gap);
    }
    for (let y = -gap; y <= h + gap; y += gap) {
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
      glow.addColorStop(0, "rgba(61, 224, 232, 0.16)");
      glow.addColorStop(0.45, "rgba(61, 224, 232, 0.04)");
      glow.addColorStop(1, "rgba(4, 6, 12, 0)");
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
    shade.addColorStop(0, "rgba(4, 6, 12, 0)");
    shade.addColorStop(1, "rgba(4, 6, 12, 0.66)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);

    const tighten = this.reduced ? 0 : this.tighten;
    this.placed = this.nodes.map((node) => {
      let x = node.x * w;
      let y = node.y * h;
      const dragging = this.drag?.id === node.id;
      if (!this.reduced && !dragging) {
        x += Math.sin(time * 0.001 + node.x * 12) * 3.2;
        y += Math.cos(time * 0.0012 + node.y * 10) * 2.4;
      }
      if (tighten > 0 && !dragging) {
        x += (w * 0.5 - x) * tighten * 0.2;
        y += (h * 0.54 - y) * tighten * 0.2;
      }
      return { ...node, px: x, py: y };
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
          ? "rgba(61, 224, 232, 0.9)"
          : "rgba(61, 224, 232, 0.55)"
        : "rgba(22, 78, 88, 0.95)";
      ctx.lineWidth = hot ? 1.4 : 1;
      ctx.stroke();
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
      ctx.strokeStyle = this.locked ? "rgba(61, 224, 232, 0.35)" : "rgba(255, 209, 102, 0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, node.r, 0, Math.PI * 2);
    ctx.fillStyle = "#080c14";
    ctx.fill();
    const mark = this.marks[node.id] ?? "idle";
    ctx.lineWidth = node.agent || mark === "open" ? 2 : 1.25;
    if (node.agent && this.locked) ctx.strokeStyle = "#3de0e8";
    else if (node.agent || mark === "open") ctx.strokeStyle = "#ffd166";
    else if (mark === "done") ctx.strokeStyle = "#3de0e8";
    else ctx.strokeStyle = "#5c6066";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(4, node.r - 6), 0, Math.PI * 2);
    ctx.strokeStyle = "#242628";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, node.agent ? 4 : 2.4, 0, Math.PI * 2);
    if (node.agent) ctx.fillStyle = this.locked ? "#3de0e8" : "#ffd166";
    else if (mark === "open") ctx.fillStyle = "#ffd166";
    else if (mark === "done") ctx.fillStyle = "#3de0e8";
    else ctx.fillStyle = "#58d2b4";
    ctx.fill();
    if (focused) {
      const size = node.r + 8;
      const arm = 7;
      ctx.strokeStyle = "#ffd166";
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
    ctx.font = "500 16px 'Barlow Condensed', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const y = node.py + node.r + 8;
    const mark = this.marks[node.id] ?? "idle";
    ctx.fillStyle = "#0c0e10";
    ctx.fillText(node.label, node.px + 1, y + 1);
    if (node.agent) ctx.fillStyle = "#eceeec";
    else if (mark === "open") ctx.fillStyle = "#ffd166";
    else if (mark === "done") ctx.fillStyle = "#3de0e8";
    else ctx.fillStyle = "#a8b2bc";
    ctx.fillText(node.label, node.px, y);
  }
}
