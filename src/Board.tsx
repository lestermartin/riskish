import { useMemo } from 'react';
import type { Territory as TerritoryRow } from './module_bindings/types';
import { CONTINENTS, EDGES, NEUTRAL_COLOR, TERRITORIES } from '../spacetimedb/src/riskMap.ts';

const W = 1000;
const H = 560;
const WRAP_EDGE: [number, number] = [0, 29]; // Alaska ↔ Kamchatka wraps around the board

interface Props {
  territories: readonly TerritoryRow[];
  colorForSeat: (seat: number) => string;
  /** Territory indexes that respond to clicks. */
  clickable: Set<number>;
  /** Highlighted (e.g. selected source) territories. */
  selected: Set<number>;
  /** Secondary highlight (valid targets). */
  targets: Set<number>;
  onClick: (idx: number) => void;
}

type Pt = [number, number];

function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const CONTINENT_LABEL_POS: Pt[] = [
  [70, 30], // North America
  [60, 535], // South America
  [400, 30], // Europe
  [395, 520], // Africa
  [660, 30], // Asia
  [890, 545], // Australia
];

export function Board({ territories, colorForSeat, clickable, selected, targets, onClick }: Props) {
  const hulls = useMemo(
    () =>
      CONTINENTS.map((_, ci) =>
        convexHull(
          TERRITORIES.filter(t => t.continent === ci).map(t => [t.x, t.y] as Pt)
        )
          .map(p => p.join(','))
          .join(' ')
      ),
    []
  );

  const byIdx = new Map(territories.map(t => [t.idx, t]));

  return (
    <svg className="board" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="World map">
      <defs>
        <radialGradient id="ocean" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#1a3f63" />
          <stop offset="100%" stopColor="#0d2238" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={W} height={H} fill="url(#ocean)" />

      {/* Continents: padded convex hulls via a thick, round-joined stroke. */}
      {CONTINENTS.map((c, ci) => (
        <polygon
          key={c.name}
          points={hulls[ci]}
          fill={c.color}
          fillOpacity={0.28}
          stroke={c.color}
          strokeOpacity={0.28}
          strokeWidth={58}
          strokeLinejoin="round"
        />
      ))}
      {CONTINENTS.map((c, ci) => (
        <text
          key={c.name}
          className="continent-label"
          x={CONTINENT_LABEL_POS[ci][0]}
          y={CONTINENT_LABEL_POS[ci][1]}
          fill={c.color}
        >
          {c.name} +{c.bonus}
        </text>
      ))}

      {/* Adjacency lines; cross-continent links are dashed. */}
      {EDGES.filter(([a, b]) => !(a === WRAP_EDGE[0] && b === WRAP_EDGE[1])).map(
        ([a, b]) => {
          const ta = TERRITORIES[a];
          const tb = TERRITORIES[b];
          const sea = ta.continent !== tb.continent;
          return (
            <line
              key={`${a}-${b}`}
              x1={ta.x}
              y1={ta.y}
              x2={tb.x}
              y2={tb.y}
              stroke={sea ? '#9fb6d6' : '#e8eef7'}
              strokeOpacity={sea ? 0.55 : 0.28}
              strokeWidth={sea ? 1.5 : 1.2}
              strokeDasharray={sea ? '5 4' : undefined}
            />
          );
        }
      )}
      <line x1={TERRITORIES[0].x} y1={TERRITORIES[0].y} x2={0} y2={TERRITORIES[0].y - 10}
        stroke="#9fb6d6" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="5 4" />
      <line x1={TERRITORIES[29].x} y1={TERRITORIES[29].y} x2={W} y2={TERRITORIES[29].y - 10}
        stroke="#9fb6d6" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="5 4" />

      {TERRITORIES.map((t, idx) => {
        const row = byIdx.get(idx);
        const unclaimed = !row || (row.ownerSeat === -1 && row.armies === 0);
        const fill = unclaimed ? 'transparent' : row.ownerSeat === -1 ? NEUTRAL_COLOR : colorForSeat(row.ownerSeat);
        const isClickable = clickable.has(idx);
        const isSelected = selected.has(idx);
        const isTarget = targets.has(idx);
        return (
          <g
            key={idx}
            className={`territory${isClickable ? ' clickable' : ''}`}
            onClick={isClickable ? () => onClick(idx) : undefined}
          >
            <title>
              {t.name} ({CONTINENTS[t.continent].name})
              {row && !unclaimed ? ` — ${row.armies} armies` : ' — unclaimed'}
            </title>
            {(isSelected || isTarget) && (
              <circle
                cx={t.x}
                cy={t.y}
                r={isSelected ? 25 : 23}
                fill="none"
                stroke={isSelected ? '#ffe28a' : '#ffffff'}
                strokeWidth={isSelected ? 4 : 2}
                strokeDasharray={isTarget && !isSelected ? '4 3' : undefined}
                filter="url(#glow)"
              />
            )}
            <circle
              className="body"
              cx={t.x}
              cy={t.y}
              r={17}
              fill={fill}
              stroke={unclaimed ? '#d6e1f0' : 'rgba(255,255,255,0.85)'}
              strokeWidth={unclaimed ? 1.5 : 2}
              strokeDasharray={unclaimed ? '3 3' : undefined}
            />
            {!unclaimed && (
              <text className="armies" x={t.x} y={t.y + 4.5} textAnchor="middle">
                {row.armies}
              </text>
            )}
            <text className="label" x={t.x} y={t.y + 30} textAnchor="middle">
              {t.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
