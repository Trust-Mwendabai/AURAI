// @ts-nocheck
/**
 * Renders a saved forecast as a self-contained inline SVG for embedding in a
 * report.
 *
 * SVG rather than a rasterised screenshot for three reasons: the report body is
 * stored as HTML in the database and a PNG data URL would bloat it by two
 * orders of magnitude; it stays sharp when the report is printed to PDF; and it
 * needs no image hosting.
 *
 * Colours are chosen to read on both the dark editor and the white page the
 * report prints onto, since the same markup serves both.
 */

const INK = "#8a8a99";
const LINE = "#7c5cff";
const BAND = "rgba(124, 92, 255, 0.18)";

// The forecast name is user-supplied and goes into markup, so it is escaped.
function esc(text: string) {
  return String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function forecastSvg(prediction: any, { width = 680, height = 300 } = {}) {
  const points = prediction?.forecast || [];
  if (points.length < 2) return "";

  const pad = { top: 28, right: 16, bottom: 34, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const lows = points.map((p: any) => Number(p.low ?? p.value));
  const highs = points.map((p: any) => Number(p.high ?? p.value));
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  if (min === max) { min -= 1; max += 1; }
  // A little headroom so the line never sits on the frame.
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const x = (i: number) => pad.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  const line = points.map((p: any, i: number) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(p.value)).toFixed(1)}`).join("");

  const hasBand = points.some((p: any) => p.high !== p.low);
  const band = hasBand
    ? points.map((p: any, i: number) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(p.high)).toFixed(1)}`).join("") +
      points.slice().reverse().map((p: any, i: number) => {
        const idx = points.length - 1 - i;
        return `L${x(idx).toFixed(1)},${y(Number(p.low)).toFixed(1)}`;
      }).join("") + "Z"
    : "";

  // Four horizontal guides, labelled.
  const ticks = Array.from({ length: 4 }, (_, i) => min + ((max - min) * i) / 3);
  const gridLines = ticks.map((t) => {
    const yy = y(t).toFixed(1);
    const label = Math.abs(t) >= 1000 ? Math.round(t).toLocaleString() : Number(t.toFixed(2)).toString();
    return `<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="${INK}" stroke-opacity="0.25" stroke-dasharray="3 5"/>` +
           `<text x="${pad.left - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="${INK}">${esc(label)}</text>`;
  }).join("");

  // Label the ends and the middle only — one label per point would collide.
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const xLabels = [...new Set(labelIdx)].map((i) => {
    const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
    return `<text x="${x(i).toFixed(1)}" y="${height - 12}" text-anchor="${anchor}" font-size="10" fill="${INK}">${esc(points[i].label ?? `T+${i + 1}`)}</text>`;
  }).join("");

  const accuracy = prediction.accuracy != null ? ` · ${prediction.accuracy}% accuracy` : "";
  const title = esc(`${prediction.name ?? "Forecast"}${accuracy}`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" ` +
    `style="max-width:${width}px;height:auto;font-family:system-ui,sans-serif" role="img" aria-label="${title}">` +
    `<text x="${pad.left}" y="16" font-size="12" font-weight="600" fill="${INK}">${title}</text>` +
    gridLines +
    (band ? `<path d="${band}" fill="${BAND}" stroke="none"/>` : "") +
    `<path d="${line}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    xLabels +
    `</svg>`
  );
}

/** The chart plus a caption, as one block ready to drop into a report. */
export function forecastFigure(prediction: any) {
  const svg = forecastSvg(prediction);
  if (!svg) return "";
  const parts = [
    prediction.target ? `Target: ${prediction.target}` : "",
    prediction.horizon ? `${prediction.horizon} ${String(prediction.period ?? "").toLowerCase()}`.trim() : "",
    prediction.algorithm || "",
  ].filter(Boolean).join(" · ");

  return (
    `<figure style="margin:20px 0">${svg}` +
    `<figcaption style="font-size:12px;opacity:0.7;margin-top:6px">${esc(parts)}</figcaption>` +
    `</figure><p><br></p>`
  );
}
