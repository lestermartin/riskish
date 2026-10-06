// Static board data for World Domination RISK. Shared by the server module and
// the React client (the client imports this file directly).

export interface Continent {
  name: string;
  bonus: number;
  color: string;
}

export interface Territory {
  name: string;
  continent: number;
  /** Card design: 0 = Infantry, 1 = Cavalry, 2 = Artillery. */
  symbol: number;
  /** Board coordinates on a 1000 x 560 canvas. */
  x: number;
  y: number;
}

export const CONTINENTS: Continent[] = [
  { name: 'North America', bonus: 5, color: '#d9a93f' },
  { name: 'South America', bonus: 2, color: '#c8553d' },
  { name: 'Europe', bonus: 5, color: '#4f7cc4' },
  { name: 'Africa', bonus: 3, color: '#a7663a' },
  { name: 'Asia', bonus: 7, color: '#4f9a5a' },
  { name: 'Australia', bonus: 2, color: '#8f5fb8' },
];

const NA = 0, SA = 1, EU = 2, AF = 3, AS = 4, AU = 5;
const INF = 0, CAV = 1, ART = 2;

export const TERRITORIES: Territory[] = [
  // North America (0-8)
  { name: 'Alaska', continent: NA, symbol: INF, x: 62, y: 88 },
  { name: 'Northwest Territory', continent: NA, symbol: ART, x: 165, y: 82 },
  { name: 'Greenland', continent: NA, symbol: CAV, x: 335, y: 52 },
  { name: 'Alberta', continent: NA, symbol: CAV, x: 140, y: 148 },
  { name: 'Ontario', continent: NA, symbol: CAV, x: 222, y: 150 },
  { name: 'Quebec', continent: NA, symbol: CAV, x: 302, y: 148 },
  { name: 'Western United States', continent: NA, symbol: ART, x: 150, y: 220 },
  { name: 'Eastern United States', continent: NA, symbol: ART, x: 245, y: 228 },
  { name: 'Central America', continent: NA, symbol: ART, x: 178, y: 298 },
  // South America (9-12)
  { name: 'Venezuela', continent: SA, symbol: INF, x: 252, y: 345 },
  { name: 'Peru', continent: SA, symbol: INF, x: 245, y: 420 },
  { name: 'Brazil', continent: SA, symbol: ART, x: 325, y: 400 },
  { name: 'Argentina', continent: SA, symbol: INF, x: 270, y: 500 },
  // Europe (13-19)
  { name: 'Iceland', continent: EU, symbol: INF, x: 425, y: 95 },
  { name: 'Great Britain', continent: EU, symbol: ART, x: 418, y: 170 },
  { name: 'Scandinavia', continent: EU, symbol: CAV, x: 510, y: 88 },
  { name: 'Northern Europe', continent: EU, symbol: ART, x: 500, y: 168 },
  { name: 'Western Europe', continent: EU, symbol: ART, x: 430, y: 245 },
  { name: 'Southern Europe', continent: EU, symbol: ART, x: 520, y: 235 },
  { name: 'Ukraine', continent: EU, symbol: CAV, x: 595, y: 135 },
  // Africa (20-25)
  { name: 'North Africa', continent: AF, symbol: CAV, x: 455, y: 330 },
  { name: 'Egypt', continent: AF, symbol: INF, x: 545, y: 310 },
  { name: 'East Africa', continent: AF, symbol: INF, x: 600, y: 385 },
  { name: 'Congo', continent: AF, symbol: INF, x: 525, y: 410 },
  { name: 'South Africa', continent: AF, symbol: ART, x: 545, y: 495 },
  { name: 'Madagascar', continent: AF, symbol: CAV, x: 640, y: 480 },
  // Asia (26-37)
  { name: 'Ural', continent: AS, symbol: CAV, x: 690, y: 115 },
  { name: 'Siberia', continent: AS, symbol: CAV, x: 765, y: 80 },
  { name: 'Yakutsk', continent: AS, symbol: CAV, x: 855, y: 62 },
  { name: 'Kamchatka', continent: AS, symbol: INF, x: 940, y: 80 },
  { name: 'Irkutsk', continent: AS, symbol: CAV, x: 840, y: 135 },
  { name: 'Mongolia', continent: AS, symbol: INF, x: 862, y: 200 },
  { name: 'Japan', continent: AS, symbol: ART, x: 950, y: 205 },
  { name: 'Afghanistan', continent: AS, symbol: CAV, x: 675, y: 200 },
  { name: 'China', continent: AS, symbol: INF, x: 790, y: 252 },
  { name: 'Middle East', continent: AS, symbol: INF, x: 630, y: 280 },
  { name: 'India', continent: AS, symbol: CAV, x: 718, y: 310 },
  { name: 'Siam', continent: AS, symbol: INF, x: 805, y: 330 },
  // Australia (38-41)
  { name: 'Indonesia', continent: AU, symbol: ART, x: 830, y: 415 },
  { name: 'New Guinea', continent: AU, symbol: INF, x: 925, y: 400 },
  { name: 'Western Australia', continent: AU, symbol: ART, x: 855, y: 498 },
  { name: 'Eastern Australia', continent: AU, symbol: ART, x: 945, y: 490 },
];

export const NUM_TERRITORIES = TERRITORIES.length;

/** Each pair of territory indexes that may attack each other. */
export const EDGES: Array<[number, number]> = [
  // North America
  [0, 1], [0, 3], [0, 29], // Alaska - NWT, Alberta, Kamchatka
  [1, 3], [1, 4], [1, 2],
  [2, 4], [2, 5], [2, 13], // Greenland - Ontario, Quebec, Iceland
  [3, 4], [3, 6],
  [4, 5], [4, 6], [4, 7],
  [5, 7],
  [6, 7], [6, 8],
  [7, 8],
  [8, 9], // Central America - Venezuela
  // South America
  [9, 10], [9, 11],
  [10, 11], [10, 12],
  [11, 12], [11, 20], // Brazil - North Africa
  // Europe
  [13, 14], [13, 15],
  [14, 15], [14, 16], [14, 17],
  [15, 16], [15, 19],
  [16, 17], [16, 18], [16, 19],
  [17, 18], [17, 20],
  [18, 19], [18, 20], [18, 21], [18, 35],
  [19, 26], [19, 33], [19, 35],
  // Africa
  [20, 21], [20, 22], [20, 23],
  [21, 22], [21, 35],
  [22, 23], [22, 24], [22, 25], [22, 35],
  [23, 24],
  [24, 25],
  // Asia
  [26, 27], [26, 33], [26, 34],
  [27, 28], [27, 30], [27, 31], [27, 34],
  [28, 29], [28, 30],
  [29, 30], [29, 31], [29, 32],
  [30, 31],
  [31, 32], [31, 34],
  [33, 34], [33, 35], [33, 36],
  [34, 36], [34, 37],
  [35, 36],
  [36, 37],
  [37, 38], // Siam - Indonesia
  // Australia
  [38, 39], [38, 40],
  [39, 40], [39, 41],
  [40, 41],
];

export const ADJACENCY: number[][] = TERRITORIES.map(() => []);
for (const [a, b] of EDGES) {
  ADJACENCY[a].push(b);
  ADJACENCY[b].push(a);
}

export function isAdjacent(a: number, b: number): boolean {
  return ADJACENCY[a]?.includes(b) ?? false;
}

export const SYMBOL_NAMES = ['Infantry', 'Cavalry', 'Artillery', 'Wild'];
export const WILD = 3;

export const PLAYER_COLORS = [
  '#d64545', // red
  '#3a6fd8', // blue
  '#2f9e55', // green
  '#d9a21b', // yellow
  '#8e4fc9', // purple
  '#e0702c', // orange
];
export const NEUTRAL_COLOR = '#8a8a8a';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Starting infantry per player, by player count. */
export function startingArmies(players: number): number {
  return { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 }[players] ?? 20;
}

/** Armies awarded for the Nth matched set traded in (n is 1-based). */
export function setValue(n: number): number {
  const table = [4, 6, 8, 10, 12, 15];
  return n <= 6 ? table[n - 1] : 15 + (n - 6) * 5;
}

/** A valid set: 3 of one design, 1 of each design, or any 2 plus a wild. */
export function isValidSet(symbols: number[]): boolean {
  if (symbols.length !== 3) return false;
  if (symbols.some(s => s === WILD)) return true;
  const distinct = new Set(symbols).size;
  return distinct === 1 || distinct === 3;
}
