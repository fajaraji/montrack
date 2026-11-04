import { useState } from "react";
import { formatRupiah, formatRupiahShort } from "../../shared/money";

/** Path kurva halus (Catmull-Rom → Bézier) melalui titik-titik. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    // Titik kendali dibatasi di antara kedua titik agar kurva tidak melampaui data
    // (mis. turun di bawah 0 saat nilainya datar lalu naik tajam).
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Grafik garis halus dengan sumbu Y ringkas dan titik yang bisa diketuk. */
export function LineChart({ labels, series, height = 200 }: { labels: string[]; series: Series[]; height?: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / p) * p;
  })();
  const x = (i: number) => padL + (labels.length <= 1 ? 0 : (i * (W - padL - padR)) / (labels.length - 1));
  const y = (v: number) => padT + (1 - v / nice) * (H - padT - padB);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(" dan ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-stone-200 dark:stroke-white/10" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-stone-400 text-[11px]">
              {t === 0 ? "0" : formatRupiahShort(t).replace("Rp", "")}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle" className={`text-[11px] ${sel === i ? "fill-current font-semibold" : "fill-stone-400"}`}>
            {l}
          </text>
        ))}
        {sel != null && <line x1={x(sel)} x2={x(sel)} y1={padT} y2={H - padB} className="stroke-stone-300 dark:stroke-white/20" strokeDasharray="4 4" />}
        {series.map((s) => {
          const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
          return (
            <g key={s.name}>
              <path d={smoothPath(pts)} fill="none" stroke={s.color} strokeWidth={3.5} strokeLinecap="round" />
              {pts.map(([px, py], i) => (
                <circle key={i} cx={px} cy={py} r={sel === i ? 5 : 3} fill={s.color} />
              ))}
            </g>
          );
        })}
        {labels.map((l, i) => (
          <rect
            key={`hit-${l}-${i}`}
            x={x(i) - (W - padL - padR) / Math.max(1, labels.length - 1) / 2}
            y={0}
            width={(W - padL - padR) / Math.max(1, labels.length - 1)}
            height={H}
            fill="transparent"
            onClick={() => setSel(sel === i ? null : i)}
          />
        ))}
      </svg>
      {sel != null && (
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <span className="font-semibold">{labels[sel]}</span>
          {series.map((s) => (
            <span key={s.name} className="tabular">
              <span className="mr-1 inline-block size-2 rounded-full" style={{ background: s.color }} />
              {s.name} {formatRupiah(s.values[sel])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
