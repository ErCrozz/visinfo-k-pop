// Renderer su Canvas 2D: disegno di nodi/archi/etichette, zoom & pan, hit-test,
// transizioni animate tra layout. Le coordinate mondo vengono trasformate a mano
// in coordinate schermo così che forme e testo restino nitidi a ogni zoom.
import * as d3 from 'd3';

export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface-1'),
    border: v('--border'),
    text: v('--text-primary'),
    text2: v('--text-secondary'),
    muted: v('--text-muted'),
    accent: v('--accent'),
    edge: v('--edge'),
    edgeStrong: v('--edge-strong'),
    halo: v('--halo'),
    dim: parseFloat(v('--dim')) || 0.12,
    artist: v('--c-artist'), group: v('--c-group'), label: v('--c-label'),
    female: v('--c-female'), male: v('--c-male'), person: v('--c-person'),
    neutral: v('--c-neutral'),
    seqLo: v('--seq-lo'), seqHi: v('--seq-hi'),
  };
}

export const EDGE_DASH = {
  membership: [],
  management: [5, 3],
  collaboration: [1.5, 3],
  label: [8, 3, 2, 3],
};

export function nodeRadius(n) {
  return Math.min(16, 2.4 + 1.1 * Math.sqrt(n.deg));
}

/** Disegna la forma del nodo (cerchio = artista, quadrato = gruppo, rombo = label). */
export function shapePath(ctx, macro, x, y, r) {
  ctx.beginPath();
  if (macro === 'group') {
    const s = r * 0.9;
    ctx.rect(x - s, y - s, 2 * s, 2 * s);
  } else if (macro === 'label') {
    const s = r * 1.3;
    ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, 2 * Math.PI);
  }
}

const truncate = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export class Renderer {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers;
    this.transform = d3.zoomIdentity;
    this.scene = null;
    this.tokens = readTokens();
    this.anim = null;
    this.hover = null;
    this._raf = 0;

    this.zoom = d3.zoom()
      .scaleExtent([0.02, 10])
      .on('start', (ev) => { if (ev.sourceEvent?.type === 'mousedown') canvas.classList.add('dragging'); })
      .on('end', () => canvas.classList.remove('dragging'))
      .on('zoom', (ev) => { this.transform = ev.transform; this.request(); });
    d3.select(canvas).call(this.zoom).on('dblclick.zoom', null);

    canvas.addEventListener('mousemove', (ev) => this._onMove(ev));
    canvas.addEventListener('mouseleave', () => this._setHover(null, null));
    canvas.addEventListener('click', (ev) => {
      const n = this.pick(ev.offsetX, ev.offsetY);
      if (n) handlers.onClick?.(n, ev);
      else handlers.onBackground?.(ev);
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.request();
  }

  refreshTokens() { this.tokens = readTokens(); this.request(); }

  setScene(scene) { this.scene = scene; this.request(); }

  request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  /* ---------------- trasformazioni ---------------- */
  sx(x) { return x * this.transform.k + this.transform.x; }
  sy(y) { return y * this.transform.k + this.transform.y; }
  screenRadius(n) { return Math.max(1.6, nodeRadius(n) * Math.min(1.8, Math.sqrt(this.transform.k))); }

  /** Adatta la vista al riquadro (in coordinate mondo) dei nodi dati. */
  fit(nodes, duration = 750, useTarget = true) {
    if (!nodes.length || !this.w) return;
    const xs = nodes.map((n) => (useTarget ? n.tx : n.cx));
    const ys = nodes.map((n) => (useTarget ? n.ty : n.cy));
    const [x0, x1] = d3.extent(xs), [y0, y1] = d3.extent(ys);
    const pad = 60;
    const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
    const k = Math.min(4, Math.max(0.02, Math.min((this.w - 2 * pad) / bw, (this.h - 2 * pad - 30) / bh)));
    const t = d3.zoomIdentity.translate(this.w / 2 - k * (x0 + x1) / 2, this.h / 2 + 15 - k * (y0 + y1) / 2).scale(k);
    const sel = d3.select(this.canvas);
    if (duration) sel.transition().duration(duration).ease(d3.easeCubicInOut).call(this.zoom.transform, t);
    else sel.call(this.zoom.transform, t);
  }

  /** Interpola (cx,cy,alpha) verso (tx,ty,talpha) per tutti i nodi. */
  animate(nodes, duration = 750) {
    for (const n of nodes) { n.sx = n.cx; n.sy = n.cy; n.salpha = n.alpha; }
    if (this.anim) this.anim.stop();
    if (!duration) {
      for (const n of nodes) { n.cx = n.tx; n.cy = n.ty; n.alpha = n.talpha; }
      this.request();
      return;
    }
    const ease = d3.easeCubicInOut;
    this.anim = d3.timer((el) => {
      const t = Math.min(1, el / duration), e = ease(t);
      for (const n of nodes) {
        n.cx = n.sx + (n.tx - n.sx) * e;
        n.cy = n.sy + (n.ty - n.sy) * e;
        n.alpha = n.salpha + (n.talpha - n.salpha) * e;
      }
      this.draw();
      if (t >= 1) { this.anim.stop(); this.anim = null; }
    });
  }

  /* ---------------- hit-test & hover ---------------- */
  pick(px, py) {
    if (!this.scene) return null;
    let best = null, bestD = Infinity;
    for (const n of this.scene.nodes) {
      if (n.alpha < 0.5) continue;
      const dx = this.sx(n.cx) - px, dy = this.sy(n.cy) - py;
      const d = Math.hypot(dx, dy);
      const r = this.screenRadius(n) + 4;
      if (d <= r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  _onMove(ev) {
    const n = this.pick(ev.offsetX, ev.offsetY);
    this._setHover(n, ev);
  }

  _setHover(n, ev) {
    this.canvas.classList.toggle('on-node', !!n);
    if (n !== this.hover) { this.hover = n; this.request(); }
    this.handlers.onHover?.(n, ev);
  }

  /* ---------------- disegno ---------------- */
  draw() {
    const { ctx, tokens: T, scene } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!scene) return;

    const hover = this.hover;
    const hoverSet = hover ? scene.neighborsOf(hover) : null;
    const emph = (n) => {
      let a = scene.emphasis(n);
      if (hoverSet && !hoverSet.has(n) && n !== hover) a = Math.min(a, T.dim);
      return a * n.alpha;
    };

    this._drawGuides(scene.guides || []);

    // --- archi: raggruppati per stile per limitare i cambi di stato del contesto
    const k = this.transform.k;
    const baseW = Math.max(0.5, Math.min(1.6, 0.9 * Math.sqrt(k)));
    const strong = [];
    for (const rel of Object.keys(EDGE_DASH)) {
      ctx.setLineDash(EDGE_DASH[rel]);
      ctx.lineCap = rel === 'collaboration' ? 'round' : 'butt';
      ctx.strokeStyle = T.edge;
      for (const e of scene.edges) {
        if (e.rel !== rel) continue;
        const a = Math.min(emph(e.s), emph(e.t)) * (scene.edgeAlpha ? scene.edgeAlpha(e) : 1);
        if (a < 0.02) continue;
        const incident = (hover && (e.s === hover || e.t === hover)) || scene.edgeHighlight?.(e);
        if (incident) { strong.push(e); continue; }
        ctx.globalAlpha = a;
        ctx.lineWidth = e.sub === 'ambiguous' ? baseW * 0.7 : baseW;
        ctx.beginPath();
        ctx.moveTo(this.sx(e.s.cx), this.sy(e.s.cy));
        ctx.lineTo(this.sx(e.t.cx), this.sy(e.t.cy));
        ctx.stroke();
      }
    }
    // archi evidenziati sopra gli altri
    ctx.strokeStyle = T.edgeStrong;
    for (const e of strong) {
      ctx.setLineDash(EDGE_DASH[e.rel]);
      ctx.globalAlpha = Math.min(e.s.alpha, e.t.alpha);
      ctx.lineWidth = baseW * 1.6;
      ctx.beginPath();
      ctx.moveTo(this.sx(e.s.cx), this.sy(e.s.cy));
      ctx.lineTo(this.sx(e.t.cx), this.sy(e.t.cy));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // --- nodi: prima quelli attenuati, poi quelli in evidenza
    const drawn = scene.nodes.filter((n) => n.alpha > 0.01);
    const withA = drawn.map((n) => [n, emph(n)]).sort((a, b) => a[1] - b[1] || a[0].deg - b[0].deg);
    for (const [n, a] of withA) {
      if (a < 0.01) continue;
      const x = this.sx(n.cx), y = this.sy(n.cy), r = this.screenRadius(n);
      if (x < -30 || y < -30 || x > this.w + 30 || y > this.h + 30) continue;
      ctx.globalAlpha = a;
      shapePath(ctx, n.macro, x, y, r);
      const fill = scene.colorOf(n);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.lineWidth = r > 3 ? 1.2 : 0.6;
      ctx.strokeStyle = fill ? T.surface : scene.outlineOf?.(n) || T.muted;
      if (!fill) ctx.lineWidth = 1.4;
      ctx.stroke();
      const ring = scene.ringOf?.(n);
      if (ring) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = ring === 'focus' ? T.text : T.accent;
        shapePath(ctx, n.macro, x, y, r + 3);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    this._drawLabels(drawn, emph, hover, hoverSet);
  }

  _drawGuides(guides) {
    const { ctx, tokens: T } = this;
    ctx.save();
    ctx.font = '11px system-ui, "Segoe UI", sans-serif';
    for (const g of guides) {
      if (g.kind === 'ring') {
        const r = g.r * this.transform.k;
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = T.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(this.sx(0), this.sy(0), r, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = T.muted;
        ctx.textAlign = 'center';
        ctx.fillText(g.label, this.sx(0), this.sy(0) - r - 6);
      } else if (g.kind === 'level') {
        ctx.fillStyle = T.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(g.label.toUpperCase(), 10, this.sy(g.y));
      } else if (g.kind === 'text') {
        ctx.fillStyle = T.muted;
        ctx.textAlign = 'center';
        ctx.fillText(g.label, this.sx(g.x), this.sy(g.y));
      }
    }
    ctx.restore();
  }

  _drawLabels(drawn, emph, hover, hoverSet) {
    const { ctx, tokens: T, scene } = this;
    const budget = Math.max(40, Math.floor((this.w * this.h) / 5200));
    // priorità: hover > selezionato/focus > vicini dell'hover > politica della scena
    const cands = [];
    for (const n of drawn) {
      if (n.alpha < 0.6) continue;
      const a = emph(n);
      let p = scene.labelPriority(n, this) ;
      if (n === hover) p = 1e9;
      else if (hoverSet?.has(n)) p = Math.max(p, 1e6 + n.deg);
      if (p <= 0 || a < 0.3) continue;
      cands.push([n, p]);
    }
    cands.sort((a, b) => b[1] - a[1]);

    ctx.font = '11.5px system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    ctx.lineJoin = 'round';
    const boxes = [];
    const hit = (b) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    let count = 0;
    for (const [n, p] of cands) {
      if (count >= budget && p < 1e6) break;
      const x = this.sx(n.cx), y = this.sy(n.cy), r = this.screenRadius(n);
      if (x < -50 || y < -20 || x > this.w + 50 || y > this.h + 20) continue;
      const text = truncate(n.name, n === hover ? 60 : 26);
      const w = ctx.measureText(text).width, h = 13;
      const lp = scene.labelPlacement?.(n) || { lp: 'below' };
      let tx, ty, align;
      if (lp.lp === 'right') { tx = x + r + 5; ty = y; align = 'left'; }
      else if (lp.lp === 'above') { tx = x; ty = y - r - 9; align = 'center'; }
      else if (lp.lp === 'radial') {
        const c = Math.cos(lp.angle), s = Math.sin(lp.angle);
        tx = x + c * (r + 5); ty = y + s * (r + 5);
        align = c >= 0 ? 'left' : 'right';
      } else { tx = x; ty = y + r + 10; align = 'center'; }
      const x0 = align === 'left' ? tx : align === 'right' ? tx - w : tx - w / 2;
      const box = { x0: x0 - 2, x1: x0 + w + 2, y0: ty - h / 2 - 1, y1: ty + h / 2 + 1 };
      if (p < 1e6 && hit(box)) continue;
      boxes.push(box);
      count++;
      ctx.globalAlpha = Math.min(1, emph(n) + 0.2);
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = T.halo;
      ctx.lineWidth = 3.5;
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = n === hover || p >= 1e8 ? T.text : T.text2;
      ctx.fillText(text, tx, ty);
    }
    ctx.globalAlpha = 1;
  }
}
