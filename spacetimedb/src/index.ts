import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
} from 'spacetimedb/server';
import {
  CONTINENTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NUM_TERRITORIES,
  PLAYER_COLORS,
  TERRITORIES,
  WILD,
  isAdjacent,
  isValidSet,
  setValue,
  startingArmies,
} from './riskMap';
import { constantTimeEquals, hashPassword, toHex } from './sha256';

// ─── Tables ────────────────────────────────────────────────────────────────

/** Registered players. */
const user = table(
  { name: 'user', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    username: t.string(),
    usernameLower: t.string().unique(),
    createdAt: t.timestamp(),
    online: t.bool(),
    gamesPlayed: t.u32(),
    wins: t.u32(),
  }
);

/** Password hashes. Private: never replicated to clients. */
const credential = table(
  { name: 'credential' },
  {
    userId: t.u64().primaryKey(),
    salt: t.string(),
    hash: t.string(),
  }
);

/** Which user an authenticated SpacetimeDB identity is logged in as. */
const session = table(
  { name: 'session', public: true },
  {
    identity: t.identity().primaryKey(),
    userId: t.u64().index('btree'),
  }
);

/** Live connection count per identity, used to derive `user.online`. */
const presence = table(
  { name: 'presence' },
  {
    identity: t.identity().primaryKey(),
    connections: t.u32(),
  }
);

const Battle = t.object('Battle', {
  from: t.u8(),
  to: t.u8(),
  attackerSeat: t.u8(),
  defenderSeat: t.i8(),
  attackerDice: t.array(t.u8()),
  defenderDice: t.array(t.u8()),
  attackerLosses: t.u32(),
  defenderLosses: t.u32(),
  rolls: t.u32(),
  captured: t.bool(),
});

/**
 * status: lobby → claim → deploy → playing → finished
 *   (2-player games skip `claim`; territories are dealt with a neutral army)
 * phase (while playing): reinforce → attack ⇄ occupy → fortify
 */
const game = table(
  { name: 'game', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    creatorId: t.u64(),
    status: t.string().index('btree'),
    createdAt: t.timestamp(),
    startedAt: t.option(t.timestamp()),
    finishedAt: t.option(t.timestamp()),
    playerCount: t.u8(),
    currentSeat: t.u8(),
    phase: t.string(),
    turnNumber: t.u32(),
    reinforcements: t.u32(),
    setsTraded: t.u32(),
    conqueredThisTurn: t.bool(),
    cardBonusTaken: t.bool(),
    forcedTrade: t.bool(),
    occupyFrom: t.u8(),
    occupyTo: t.u8(),
    lastBattle: t.option(Battle),
    winnerId: t.option(t.u64()),
    winnerName: t.string(),
  }
);

const gamePlayer = table(
  { name: 'game_player', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64().index('btree'),
    userId: t.u64().index('btree'),
    username: t.string(),
    joinedAt: t.timestamp(),
    seat: t.u8(),
    color: t.string(),
    armiesToPlace: t.u32(),
    cardCount: t.u32(),
    eliminated: t.bool(),
    forfeited: t.bool(),
  }
);

/** ownerSeat = -1 means unclaimed (armies = 0) or neutral (armies > 0). */
const territory = table(
  {
    name: 'territory',
    public: true,
    indexes: [
      { accessor: 'by_game_idx', algorithm: 'btree', columns: ['gameId', 'idx'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    idx: t.u8(),
    ownerSeat: t.i8(),
    armies: t.u32(),
  }
);

/** RISK cards. Private: each player sees only their own hand (my_cards view). */
const card = table(
  {
    name: 'card',
    indexes: [
      {
        accessor: 'by_game_holder',
        algorithm: 'btree',
        columns: ['gameId', 'holderSeat'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    /** -1 for wild cards. */
    territoryIdx: t.i16(),
    symbol: t.u8(),
    /** deck | hand | discard */
    location: t.string(),
    holderSeat: t.i8(),
  }
);

/** gameId = 0 is the global lobby channel; otherwise the game's own channel. */
const chatMessage = table(
  { name: 'chat_message', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64().index('btree'),
    userId: t.u64(),
    username: t.string(),
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

const gameLog = table(
  { name: 'game_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64().index('btree'),
    text: t.string(),
    at: t.timestamp(),
  }
);

const spacetimedb = schema({
  user,
  credential,
  session,
  presence,
  game,
  gamePlayer,
  territory,
  card,
  chatMessage,
  gameLog,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type GameRow = NonNullable<ReturnType<Ctx['db']['game']['id']['find']>>;
type PlayerRow = NonNullable<ReturnType<Ctx['db']['gamePlayer']['id']['find']>>;
type UserRow = NonNullable<ReturnType<Ctx['db']['user']['id']['find']>>;
type TerritoryRow = NonNullable<ReturnType<Ctx['db']['territory']['id']['find']>>;

const GLOBAL_CHANNEL = 0n;
const MAX_CHAT_HISTORY = 300;
const MAX_LOG_HISTORY = 200;
const ACTIVE_STATUSES = ['lobby', 'claim', 'deploy', 'playing'];

// ─── Helpers: users & presence ─────────────────────────────────────────────

function currentUser(ctx: Ctx): UserRow {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) throw new SenderError('You must be logged in');
  const u = ctx.db.user.id.find(s.userId);
  if (!u) throw new SenderError('Unknown user');
  return u;
}

function refreshOnline(ctx: Ctx, userId: bigint) {
  const u = ctx.db.user.id.find(userId);
  if (!u) return;
  let online = false;
  for (const s of ctx.db.session.userId.filter(userId)) {
    const p = ctx.db.presence.identity.find(s.identity);
    if (p && p.connections > 0) {
      online = true;
      break;
    }
  }
  if (u.online !== online) ctx.db.user.id.update({ ...u, online });
}

function bindSession(ctx: Ctx, userId: bigint) {
  const existing = ctx.db.session.identity.find(ctx.sender);
  if (existing) {
    ctx.db.session.identity.update({ ...existing, userId });
    if (existing.userId !== userId) refreshOnline(ctx, existing.userId);
  } else {
    ctx.db.session.insert({ identity: ctx.sender, userId });
  }
  refreshOnline(ctx, userId);
}

function validateUsername(username: string): string {
  const name = username.trim();
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(name))
    throw new SenderError(
      'Username must be 3-20 characters: letters, numbers, _ or -'
    );
  return name;
}

// ─── Helpers: games ────────────────────────────────────────────────────────

function requireGame(ctx: Ctx, gameId: bigint): GameRow {
  const g = ctx.db.game.id.find(gameId);
  if (!g) throw new SenderError('Game not found');
  return g;
}

function playersOf(ctx: Ctx, gameId: bigint): PlayerRow[] {
  return [...ctx.db.gamePlayer.gameId.filter(gameId)].sort(
    (a, b) => a.seat - b.seat
  );
}

function findPlayer(ctx: Ctx, gameId: bigint, userId: bigint) {
  for (const p of ctx.db.gamePlayer.gameId.filter(gameId))
    if (p.userId === userId) return p;
  return undefined;
}

function playerAtSeat(ctx: Ctx, gameId: bigint, seat: number) {
  for (const p of ctx.db.gamePlayer.gameId.filter(gameId))
    if (p.seat === seat) return p;
  return undefined;
}

function activeGameOf(ctx: Ctx, userId: bigint) {
  for (const p of ctx.db.gamePlayer.userId.filter(userId)) {
    const g = ctx.db.game.id.find(p.gameId);
    if (g && ACTIVE_STATUSES.includes(g.status) && !p.eliminated) return g;
  }
  return undefined;
}

function territoriesOf(ctx: Ctx, gameId: bigint): TerritoryRow[] {
  return [...ctx.db.territory.by_game_idx.filter(gameId)].sort(
    (a, b) => a.idx - b.idx
  );
}

function getTerritory(ctx: Ctx, gameId: bigint, idx: number): TerritoryRow {
  if (!Number.isInteger(idx) || idx < 0 || idx >= NUM_TERRITORIES)
    throw new SenderError('Invalid territory');
  for (const tr of ctx.db.territory.by_game_idx.filter([gameId, idx])) return tr;
  throw new SenderError('Territory not found');
}

function log(ctx: Ctx, gameId: bigint, text: string) {
  ctx.db.gameLog.insert({ id: 0n, gameId, text, at: ctx.timestamp });
  const rows = [...ctx.db.gameLog.gameId.filter(gameId)];
  if (rows.length > MAX_LOG_HISTORY) {
    rows.sort(byTime(r => r.at.microsSinceUnixEpoch));
    for (const r of rows.slice(0, rows.length - MAX_LOG_HISTORY))
      ctx.db.gameLog.id.delete(r.id);
  }
}

function byTime<T extends { id: bigint }>(key: (r: T) => bigint) {
  return (a: T, b: T) => {
    const d = key(a) - key(b);
    return d < 0n ? -1 : d > 0n ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function shuffle<T>(ctx: Ctx, items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = ctx.random.integerInRange(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollDice(ctx: Ctx, count: number): number[] {
  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(ctx.random.integerInRange(1, 6));
  return dice.sort((a, b) => b - a);
}

function handOf(ctx: Ctx, gameId: bigint, seat: number) {
  return [...ctx.db.card.by_game_holder.filter([gameId, seat])].filter(
    c => c.location === 'hand'
  );
}

function setCardCount(ctx: Ctx, p: PlayerRow) {
  const cardCount = handOf(ctx, p.gameId, p.seat).length;
  const fresh = ctx.db.gamePlayer.id.find(p.id)!;
  ctx.db.gamePlayer.id.update({ ...fresh, cardCount });
}

/** Seats still in the game, in turn order. */
function aliveSeats(ctx: Ctx, gameId: bigint): number[] {
  return playersOf(ctx, gameId)
    .filter(p => !p.eliminated)
    .map(p => p.seat);
}

function nextAliveSeat(ctx: Ctx, g: GameRow, fromSeat: number): number {
  const alive = new Set(aliveSeats(ctx, g.id));
  for (let i = 1; i <= g.playerCount; i++) {
    const s = (fromSeat + i) % g.playerCount;
    if (alive.has(s)) return s;
  }
  return fromSeat;
}

function reinforcementsFor(ctx: Ctx, gameId: bigint, seat: number): number {
  const terrs = territoriesOf(ctx, gameId);
  const owned = terrs.filter(tr => tr.ownerSeat === seat);
  let armies = Math.max(3, Math.floor(owned.length / 3));
  CONTINENTS.forEach((c, ci) => {
    const members = terrs.filter(tr => TERRITORIES[tr.idx].continent === ci);
    if (members.length > 0 && members.every(tr => tr.ownerSeat === seat))
      armies += c.bonus;
  });
  return armies;
}

function beginTurn(ctx: Ctx, gameId: bigint, seat: number) {
  const g = ctx.db.game.id.find(gameId)!;
  const reinforcements = reinforcementsFor(ctx, gameId, seat);
  ctx.db.game.id.update({
    ...g,
    currentSeat: seat,
    phase: 'reinforce',
    turnNumber: g.turnNumber + 1,
    reinforcements,
    conqueredThisTurn: false,
    cardBonusTaken: false,
    forcedTrade: false,
  });
  const p = playerAtSeat(ctx, gameId, seat);
  log(ctx, gameId, `Turn ${g.turnNumber + 1}: ${p?.username} receives ${reinforcements} armies.`);
}

function drawCard(ctx: Ctx, gameId: bigint, seat: number) {
  let deck = [...ctx.db.card.by_game_holder.filter([gameId, -1])].filter(
    c => c.location === 'deck'
  );
  if (deck.length === 0) {
    for (const c of ctx.db.card.by_game_holder.filter([gameId, -1]))
      if (c.location === 'discard') ctx.db.card.id.update({ ...c, location: 'deck' });
    deck = [...ctx.db.card.by_game_holder.filter([gameId, -1])].filter(
      c => c.location === 'deck'
    );
  }
  if (deck.length === 0) return;
  deck.sort((a, b) => (a.id < b.id ? -1 : 1));
  const c = deck[ctx.random.integerInRange(0, deck.length - 1)];
  ctx.db.card.id.update({ ...c, location: 'hand', holderSeat: seat });
}

function deleteGameData(ctx: Ctx, gameId: bigint) {
  for (const m of [...ctx.db.chatMessage.gameId.filter(gameId)])
    ctx.db.chatMessage.id.delete(m.id);
  for (const tr of [...ctx.db.territory.by_game_idx.filter(gameId)])
    ctx.db.territory.id.delete(tr.id);
  for (const c of [...ctx.db.card.by_game_holder.filter(gameId)])
    ctx.db.card.id.delete(c.id);
  for (const l of [...ctx.db.gameLog.gameId.filter(gameId)])
    ctx.db.gameLog.id.delete(l.id);
}

/** End the game: record the winner and tear down the game's chat channel. */
function finishGame(ctx: Ctx, gameId: bigint, winnerSeat: number) {
  const g = ctx.db.game.id.find(gameId)!;
  const winner = playerAtSeat(ctx, gameId, winnerSeat)!;
  ctx.db.game.id.update({
    ...g,
    status: 'finished',
    phase: 'done',
    finishedAt: ctx.timestamp,
    winnerId: winner.userId,
    winnerName: winner.username,
  });
  for (const p of playersOf(ctx, gameId)) {
    const u = ctx.db.user.id.find(p.userId);
    if (!u) continue;
    ctx.db.user.id.update({
      ...u,
      gamesPlayed: u.gamesPlayed + 1,
      wins: u.wins + (p.userId === winner.userId ? 1 : 0),
    });
  }
  deleteGameData(ctx, gameId);
  ctx.db.chatMessage.insert({
    id: 0n,
    gameId: GLOBAL_CHANNEL,
    userId: 0n,
    username: 'system',
    text: `🏆 ${winner.username} conquered the world in "${g.name}"!`,
    sentAt: ctx.timestamp,
  });
}

/** Returns true if the game ended because only one player remains. */
function checkForWinner(ctx: Ctx, gameId: bigint): boolean {
  const alive = aliveSeats(ctx, gameId);
  if (alive.length === 1) {
    finishGame(ctx, gameId, alive[0]);
    return true;
  }
  return false;
}

function startGame(ctx: Ctx, g: GameRow) {
  const joined = [...ctx.db.gamePlayer.gameId.filter(g.id)];
  const n = joined.length;
  if (n < MIN_PLAYERS) throw new SenderError(`Need at least ${MIN_PLAYERS} players`);

  // Random seating stands in for "roll a die; highest goes first".
  const order = shuffle(ctx, joined);
  const armies = startingArmies(n);
  order.forEach((p, seat) =>
    ctx.db.gamePlayer.id.update({
      ...p,
      seat,
      color: PLAYER_COLORS[seat],
      armiesToPlace: armies,
      cardCount: 0,
      eliminated: false,
      forfeited: false,
    })
  );

  for (let idx = 0; idx < NUM_TERRITORIES; idx++)
    ctx.db.territory.insert({ id: 0n, gameId: g.id, idx, ownerSeat: -1, armies: 0 });
  for (let idx = 0; idx < NUM_TERRITORIES; idx++)
    ctx.db.card.insert({
      id: 0n,
      gameId: g.id,
      territoryIdx: idx,
      symbol: TERRITORIES[idx].symbol,
      location: 'deck',
      holderSeat: -1,
    });
  for (let i = 0; i < 2; i++)
    ctx.db.card.insert({
      id: 0n,
      gameId: g.id,
      territoryIdx: -1,
      symbol: WILD,
      location: 'deck',
      holderSeat: -1,
    });

  let status = 'claim';
  if (n === 2) {
    // Two-player variant: deal 14 territories each plus 14 neutral, with the
    // 40 neutral armies spread randomly across the neutral territories.
    status = 'deploy';
    const dealt = shuffle(ctx, [...Array(NUM_TERRITORIES).keys()]);
    const neutral: TerritoryRow[] = [];
    dealt.forEach((idx, i) => {
      const tr = getTerritory(ctx, g.id, idx);
      const ownerSeat = i < 14 ? 0 : i < 28 ? 1 : -1;
      ctx.db.territory.id.update({ ...tr, ownerSeat, armies: 1 });
      if (ownerSeat === -1) neutral.push({ ...tr, ownerSeat, armies: 1 });
    });
    for (let i = 0; i < armies - neutral.length; i++) {
      const pick = neutral[ctx.random.integerInRange(0, neutral.length - 1)];
      pick.armies += 1;
    }
    for (const tr of neutral) ctx.db.territory.id.update(tr);
    for (const p of playersOf(ctx, g.id))
      ctx.db.gamePlayer.id.update({ ...p, armiesToPlace: armies - 14 });
  }

  ctx.db.game.id.update({
    ...g,
    status,
    startedAt: ctx.timestamp,
    playerCount: n,
    currentSeat: 0,
    phase: 'setup',
  });
  log(ctx, g.id, `Game started with ${n} players. Turn order: ${order.map(p => p.username).join(', ')}.`);
  log(
    ctx,
    g.id,
    status === 'claim'
      ? `Each player has ${armies} armies. Take turns claiming empty territories.`
      : `Territories dealt (14 each, 14 neutral). Place your remaining ${armies - 14} armies.`
  );
}

/** After a setup placement (or forfeit), pass to the next seat that still has armies. */
function advanceSetup(ctx: Ctx, gameId: bigint) {
  let g = ctx.db.game.id.find(gameId)!;
  const terrs = territoriesOf(ctx, gameId);
  const players = playersOf(ctx, gameId).filter(p => !p.eliminated);
  const unclaimed = terrs.filter(tr => tr.ownerSeat === -1 && tr.armies === 0);
  const withArmies = players.filter(p => p.armiesToPlace > 0);

  if (g.status === 'claim' && (unclaimed.length === 0 || withArmies.length === 0)) {
    // Anything left unclaimed (only possible after forfeits) becomes neutral.
    for (const tr of unclaimed) ctx.db.territory.id.update({ ...tr, armies: 1 });
    ctx.db.game.id.update({ ...g, status: 'deploy' });
    g = ctx.db.game.id.find(gameId)!;
    log(ctx, gameId, 'All territories claimed. Reinforce your territories.');
  }

  if (withArmies.length === 0) {
    ctx.db.game.id.update({ ...g, status: 'playing', turnNumber: 0 });
    log(ctx, gameId, 'Setup complete. Let the conquest begin!');
    const first = players.length > 0 ? Math.min(...players.map(p => p.seat)) : 0;
    beginTurn(ctx, gameId, first);
    return;
  }

  const seats = new Set(withArmies.map(p => p.seat));
  for (let i = 1; i <= g.playerCount; i++) {
    const s = (g.currentSeat + i) % g.playerCount;
    if (seats.has(s)) {
      ctx.db.game.id.update({ ...g, currentSeat: s });
      return;
    }
  }
}

/** Require it to be the caller's turn in a game that is in progress. */
function requireTurn(ctx: Ctx, gameId: bigint, statuses: string[]) {
  const u = currentUser(ctx);
  const g = requireGame(ctx, gameId);
  if (!statuses.includes(g.status)) throw new SenderError('Not allowed right now');
  const me = findPlayer(ctx, gameId, u.id);
  if (!me || me.eliminated) throw new SenderError('You are not playing in this game');
  if (g.currentSeat !== me.seat) throw new SenderError("It's not your turn");
  return { u, g, me };
}

function requirePhase(g: GameRow, ...phases: string[]) {
  if (!phases.includes(g.phase))
    throw new SenderError(`Not allowed during the ${g.phase} phase`);
}

function eliminate(ctx: Ctx, gameId: bigint, loser: PlayerRow, by: PlayerRow | null) {
  ctx.db.gamePlayer.id.update({ ...loser, eliminated: true, armiesToPlace: 0 });
  const cards = handOf(ctx, gameId, loser.seat);
  for (const c of cards) {
    if (by) ctx.db.card.id.update({ ...c, holderSeat: by.seat });
    else ctx.db.card.id.update({ ...c, location: 'discard', holderSeat: -1 });
  }
  setCardCount(ctx, ctx.db.gamePlayer.id.find(loser.id)!);
  if (by) {
    setCardCount(ctx, by);
    log(ctx, gameId, `☠ ${by.username} eliminated ${loser.username} and took ${cards.length} card(s).`);
  }
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const p = ctx.db.presence.identity.find(ctx.sender);
  if (p) ctx.db.presence.identity.update({ ...p, connections: p.connections + 1 });
  else ctx.db.presence.insert({ identity: ctx.sender, connections: 1 });
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s) refreshOnline(ctx, s.userId);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const p = ctx.db.presence.identity.find(ctx.sender);
  if (p) {
    const connections = Math.max(0, p.connections - 1);
    if (connections === 0) ctx.db.presence.identity.delete(ctx.sender);
    else ctx.db.presence.identity.update({ ...p, connections });
  }
  const s = ctx.db.session.identity.find(ctx.sender);
  if (s) refreshOnline(ctx, s.userId);
});

// ─── Accounts ──────────────────────────────────────────────────────────────

export const register = spacetimedb.reducer(
  { username: t.string(), password: t.string() },
  (ctx, { username, password }) => {
    const name = validateUsername(username);
    if (password.length < 6) throw new SenderError('Password must be at least 6 characters');
    if (password.length > 200) throw new SenderError('Password is too long');
    if (ctx.db.user.usernameLower.find(name.toLowerCase()))
      throw new SenderError('That username is taken');

    const u = ctx.db.user.insert({
      id: 0n,
      username: name,
      usernameLower: name.toLowerCase(),
      createdAt: ctx.timestamp,
      online: false,
      gamesPlayed: 0,
      wins: 0,
    });
    const salt = toHex(ctx.random.fill(new Uint8Array(16)));
    ctx.db.credential.insert({ userId: u.id, salt, hash: hashPassword(password, salt) });
    bindSession(ctx, u.id);
  }
);

export const login = spacetimedb.reducer(
  { username: t.string(), password: t.string() },
  (ctx, { username, password }) => {
    const u = ctx.db.user.usernameLower.find(username.trim().toLowerCase());
    const cred = u ? ctx.db.credential.userId.find(u.id) : undefined;
    if (!u || !cred || !constantTimeEquals(hashPassword(password, cred.salt), cred.hash))
      throw new SenderError('Invalid username or password');
    bindSession(ctx, u.id);
  }
);

export const logout = spacetimedb.reducer(ctx => {
  const s = ctx.db.session.identity.find(ctx.sender);
  if (!s) return;
  ctx.db.session.identity.delete(ctx.sender);
  refreshOnline(ctx, s.userId);
});

// ─── Chat ──────────────────────────────────────────────────────────────────

export const sendChat = spacetimedb.reducer(
  { gameId: t.u64(), text: t.string() },
  (ctx, { gameId, text }) => {
    const u = currentUser(ctx);
    const body = text.trim();
    if (!body) return;
    if (body.length > 500) throw new SenderError('Message is too long (500 max)');
    if (gameId !== GLOBAL_CHANNEL) {
      const g = requireGame(ctx, gameId);
      if (g.status === 'finished') throw new SenderError('This game has ended');
      if (!findPlayer(ctx, gameId, u.id))
        throw new SenderError('Only players in this game can use its chat');
    }
    ctx.db.chatMessage.insert({
      id: 0n,
      gameId,
      userId: u.id,
      username: u.username,
      text: body,
      sentAt: ctx.timestamp,
    });
    if (gameId === GLOBAL_CHANNEL) {
      const rows = [...ctx.db.chatMessage.gameId.filter(GLOBAL_CHANNEL)];
      if (rows.length > MAX_CHAT_HISTORY) {
        rows.sort(byTime(r => r.sentAt.microsSinceUnixEpoch));
        for (const r of rows.slice(0, rows.length - MAX_CHAT_HISTORY))
          ctx.db.chatMessage.id.delete(r.id);
      }
    }
  }
);

// ─── Lobby ─────────────────────────────────────────────────────────────────

function addPlayer(ctx: Ctx, g: GameRow, u: UserRow) {
  ctx.db.gamePlayer.insert({
    id: 0n,
    gameId: g.id,
    userId: u.id,
    username: u.username,
    joinedAt: ctx.timestamp,
    seat: 0,
    color: '',
    armiesToPlace: 0,
    cardCount: 0,
    eliminated: false,
    forfeited: false,
  });
}

export const createGame = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    const u = currentUser(ctx);
    if (activeGameOf(ctx, u.id)) throw new SenderError('You are already in an active game');
    const title = name.trim() || `${u.username}'s game`;
    if (title.length > 40) throw new SenderError('Game name is too long (40 max)');
    const g = ctx.db.game.insert({
      id: 0n,
      name: title,
      creatorId: u.id,
      status: 'lobby',
      createdAt: ctx.timestamp,
      startedAt: undefined,
      finishedAt: undefined,
      playerCount: 0,
      currentSeat: 0,
      phase: 'lobby',
      turnNumber: 0,
      reinforcements: 0,
      setsTraded: 0,
      conqueredThisTurn: false,
      cardBonusTaken: false,
      forcedTrade: false,
      occupyFrom: 0,
      occupyTo: 0,
      lastBattle: undefined,
      winnerId: undefined,
      winnerName: '',
    });
    addPlayer(ctx, g, u);
    ctx.db.game.id.update({ ...g, playerCount: 1 });
  }
);

export const joinGame = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const u = currentUser(ctx);
    const g = requireGame(ctx, gameId);
    if (g.status !== 'lobby') throw new SenderError('That game is no longer accepting players');
    if (activeGameOf(ctx, u.id)) throw new SenderError('You are already in an active game');
    const count = [...ctx.db.gamePlayer.gameId.filter(gameId)].length;
    if (count >= MAX_PLAYERS) throw new SenderError('That game is full');
    addPlayer(ctx, g, u);
    ctx.db.game.id.update({ ...g, playerCount: count + 1 });
    log(ctx, gameId, `${u.username} joined.`);
    if (count + 1 === MAX_PLAYERS) startGame(ctx, ctx.db.game.id.find(gameId)!);
  }
);

export const leaveGame = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const u = currentUser(ctx);
    const g = requireGame(ctx, gameId);
    if (g.status !== 'lobby') throw new SenderError('The game has started; forfeit instead');
    const me = findPlayer(ctx, gameId, u.id);
    if (!me) return;
    ctx.db.gamePlayer.id.delete(me.id);
    const rest = [...ctx.db.gamePlayer.gameId.filter(gameId)].sort(
      byTime(p => p.joinedAt.microsSinceUnixEpoch)
    );
    if (rest.length === 0) {
      deleteGameData(ctx, gameId);
      ctx.db.game.id.delete(gameId);
      return;
    }
    const creatorId = g.creatorId === u.id ? rest[0].userId : g.creatorId;
    ctx.db.game.id.update({ ...g, creatorId, playerCount: rest.length });
    log(ctx, gameId, `${u.username} left.`);
  }
);

export const beginGame = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const u = currentUser(ctx);
    const g = requireGame(ctx, gameId);
    if (g.status !== 'lobby') throw new SenderError('The game has already started');
    if (g.creatorId !== u.id) throw new SenderError('Only the game creator can start the game');
    startGame(ctx, g);
  }
);

// ─── Setup: claiming and deploying initial armies ──────────────────────────

export const setupPlace = spacetimedb.reducer(
  { gameId: t.u64(), territory: t.u8() },
  (ctx, { gameId, territory: idx }) => {
    const { g, me } = requireTurn(ctx, gameId, ['claim', 'deploy']);
    if (me.armiesToPlace === 0) throw new SenderError('You have no armies left to place');
    const tr = getTerritory(ctx, gameId, idx);
    if (g.status === 'claim') {
      if (tr.ownerSeat !== -1 || tr.armies !== 0)
        throw new SenderError('Claim an unoccupied territory');
      ctx.db.territory.id.update({ ...tr, ownerSeat: me.seat, armies: 1 });
    } else {
      if (tr.ownerSeat !== me.seat) throw new SenderError('Place armies on your own territory');
      ctx.db.territory.id.update({ ...tr, armies: tr.armies + 1 });
    }
    ctx.db.gamePlayer.id.update({ ...me, armiesToPlace: me.armiesToPlace - 1 });
    advanceSetup(ctx, gameId);
  }
);

// ─── Turn: reinforce ───────────────────────────────────────────────────────

export const tradeCards = spacetimedb.reducer(
  { gameId: t.u64(), cardIds: t.array(t.u64()) },
  (ctx, { gameId, cardIds }) => {
    const { g, me } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'reinforce');
    if (g.forcedTrade && me.cardCount <= 4)
      throw new SenderError('Your hand is down to 4 cards; no more trades this turn');
    if (new Set(cardIds).size !== 3) throw new SenderError('Select exactly 3 cards');
    const cards = cardIds.map(id => {
      const c = ctx.db.card.id.find(id);
      if (!c || c.gameId !== gameId || c.location !== 'hand' || c.holderSeat !== me.seat)
        throw new SenderError('You do not hold that card');
      return c;
    });
    if (!isValidSet(cards.map(c => c.symbol)))
      throw new SenderError('Those cards are not a matched set');

    const setsTraded = g.setsTraded + 1;
    const value = setValue(setsTraded);
    for (const c of cards)
      ctx.db.card.id.update({ ...c, location: 'discard', holderSeat: -1 });

    // +2 armies on one pictured territory you occupy (at most once per turn).
    let cardBonusTaken = g.cardBonusTaken;
    let bonusText = '';
    if (!cardBonusTaken) {
      for (const c of cards) {
        if (c.territoryIdx < 0) continue;
        const tr = getTerritory(ctx, gameId, c.territoryIdx);
        if (tr.ownerSeat === me.seat) {
          ctx.db.territory.id.update({ ...tr, armies: tr.armies + 2 });
          cardBonusTaken = true;
          bonusText = ` (+2 placed on ${TERRITORIES[tr.idx].name})`;
          break;
        }
      }
    }
    ctx.db.game.id.update({
      ...g,
      setsTraded,
      cardBonusTaken,
      reinforcements: g.reinforcements + value,
    });
    setCardCount(ctx, me);
    log(ctx, gameId, `${me.username} traded set #${setsTraded} for ${value} armies${bonusText}.`);
  }
);

export const placeArmies = spacetimedb.reducer(
  { gameId: t.u64(), territory: t.u8(), count: t.u32() },
  (ctx, { gameId, territory: idx, count }) => {
    const { g, me } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'reinforce');
    if (me.cardCount >= 5) throw new SenderError('You hold 5+ cards and must trade in a set first');
    if (count < 1 || count > g.reinforcements) throw new SenderError('Invalid number of armies');
    const tr = getTerritory(ctx, gameId, idx);
    if (tr.ownerSeat !== me.seat) throw new SenderError('Place armies on your own territory');
    ctx.db.territory.id.update({ ...tr, armies: tr.armies + count });
    ctx.db.game.id.update({ ...g, reinforcements: g.reinforcements - count });
  }
);

export const finishReinforce = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const { g, me } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'reinforce');
    if (me.cardCount >= 5) throw new SenderError('You hold 5+ cards and must trade in a set first');
    if (g.reinforcements > 0) throw new SenderError('Place all of your armies first');
    ctx.db.game.id.update({ ...g, phase: 'attack', forcedTrade: false });
  }
);

// ─── Turn: attack ──────────────────────────────────────────────────────────

export const attack = spacetimedb.reducer(
  { gameId: t.u64(), from: t.u8(), to: t.u8(), dice: t.u8(), blitz: t.bool() },
  (ctx, { gameId, from, to, dice, blitz }) => {
    const { g, me } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'attack');
    const src = getTerritory(ctx, gameId, from);
    const dst = getTerritory(ctx, gameId, to);
    if (src.ownerSeat !== me.seat) throw new SenderError('Attack from your own territory');
    if (dst.ownerSeat === me.seat) throw new SenderError('You cannot attack yourself');
    if (!isAdjacent(from, to)) throw new SenderError('Those territories are not adjacent');
    if (src.armies < 2) throw new SenderError('You need at least 2 armies to attack');
    if (dice < 1 || dice > 3 || dice > src.armies - 1)
      throw new SenderError('Roll 1-3 dice, fewer than the armies in your territory');

    let attackerArmies = src.armies;
    let defenderArmies = dst.armies;
    let attackerLosses = 0;
    let defenderLosses = 0;
    let rolls = 0;
    let aDice: number[] = [];
    let dDice: number[] = [];
    let lastAttackDice = dice;
    do {
      lastAttackDice = Math.min(dice, attackerArmies - 1);
      aDice = rollDice(ctx, lastAttackDice);
      dDice = rollDice(ctx, Math.min(2, defenderArmies));
      rolls++;
      for (let i = 0; i < Math.min(aDice.length, dDice.length); i++) {
        if (aDice[i] > dDice[i]) {
          defenderArmies--;
          defenderLosses++;
        } else {
          attackerArmies--;
          attackerLosses++;
        }
      }
    } while (blitz && defenderArmies > 0 && attackerArmies >= 2);

    const captured = defenderArmies === 0;
    const defenderSeat = dst.ownerSeat;
    const defender = defenderSeat >= 0 ? playerAtSeat(ctx, gameId, defenderSeat) : undefined;
    const defenderName = defender?.username ?? 'Neutral';

    const battle = {
      from,
      to,
      attackerSeat: me.seat,
      defenderSeat,
      attackerDice: aDice,
      defenderDice: dDice,
      attackerLosses,
      defenderLosses,
      rolls,
      captured,
    };

    const fromName = TERRITORIES[from].name;
    const toName = TERRITORIES[to].name;
    log(
      ctx,
      gameId,
      `${me.username} attacked ${toName} (${defenderName}) from ${fromName}` +
        (rolls > 1 ? ` in ${rolls} rolls` : ` [${aDice.join(',')} vs ${dDice.join(',')}]`) +
        `: attacker lost ${attackerLosses}, defender lost ${defenderLosses}.`
    );

    if (!captured) {
      ctx.db.territory.id.update({ ...src, armies: attackerArmies });
      ctx.db.territory.id.update({ ...dst, armies: defenderArmies });
      ctx.db.game.id.update({ ...g, lastBattle: battle });
      return;
    }

    // Capture: move in at least as many armies as dice rolled in the last battle.
    const moveIn = Math.min(lastAttackDice, attackerArmies - 1);
    ctx.db.territory.id.update({ ...src, armies: attackerArmies - moveIn });
    ctx.db.territory.id.update({ ...dst, ownerSeat: me.seat, armies: moveIn });
    log(ctx, gameId, `${me.username} captured ${toName}!`);

    let forcedTrade = false;
    if (defender && !territoriesOf(ctx, gameId).some(tr => tr.ownerSeat === defenderSeat)) {
      eliminate(ctx, gameId, defender, me);
      if (checkForWinner(ctx, gameId)) return;
      forcedTrade = ctx.db.gamePlayer.id.find(me.id)!.cardCount >= 6;
      if (forcedTrade) log(ctx, gameId, `${me.username} holds 6+ cards and must trade down to 4.`);
    }

    const canMoveMore = attackerArmies - moveIn > 1;
    ctx.db.game.id.update({
      ...g,
      lastBattle: battle,
      conqueredThisTurn: true,
      forcedTrade,
      phase: canMoveMore ? 'occupy' : forcedTrade ? 'reinforce' : 'attack',
      occupyFrom: from,
      occupyTo: to,
    });
  }
);

/** After a capture, optionally move additional armies into the new territory. */
export const occupy = spacetimedb.reducer(
  { gameId: t.u64(), count: t.u32() },
  (ctx, { gameId, count }) => {
    const { g } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'occupy');
    const src = getTerritory(ctx, gameId, g.occupyFrom);
    const dst = getTerritory(ctx, gameId, g.occupyTo);
    if (count > src.armies - 1) throw new SenderError('You must leave at least 1 army behind');
    if (count > 0) {
      ctx.db.territory.id.update({ ...src, armies: src.armies - count });
      ctx.db.territory.id.update({ ...dst, armies: dst.armies + count });
    }
    ctx.db.game.id.update({
      ...g,
      phase: g.forcedTrade ? 'reinforce' : 'attack',
    });
  }
);

export const endAttack = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const { g } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'attack');
    ctx.db.game.id.update({ ...g, phase: 'fortify' });
  }
);

// ─── Turn: fortify & end ───────────────────────────────────────────────────

function finishTurn(ctx: Ctx, g: GameRow, me: PlayerRow) {
  if (g.conqueredThisTurn) {
    drawCard(ctx, g.id, me.seat);
    setCardCount(ctx, me);
  }
  beginTurn(ctx, g.id, nextAliveSeat(ctx, g, me.seat));
}

export const fortify = spacetimedb.reducer(
  { gameId: t.u64(), from: t.u8(), to: t.u8(), count: t.u32() },
  (ctx, { gameId, from, to, count }) => {
    const { g, me } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'attack', 'fortify');
    const src = getTerritory(ctx, gameId, from);
    const dst = getTerritory(ctx, gameId, to);
    if (src.ownerSeat !== me.seat || dst.ownerSeat !== me.seat)
      throw new SenderError('Fortify between your own territories');
    if (!isAdjacent(from, to)) throw new SenderError('Those territories are not adjacent');
    if (count < 1 || count > src.armies - 1)
      throw new SenderError('You must leave at least 1 army behind');
    ctx.db.territory.id.update({ ...src, armies: src.armies - count });
    ctx.db.territory.id.update({ ...dst, armies: dst.armies + count });
    log(ctx, gameId, `${me.username} fortified ${TERRITORIES[to].name} with ${count} from ${TERRITORIES[from].name}.`);
    finishTurn(ctx, g, me);
  }
);

export const endTurn = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const { g, me } = requireTurn(ctx, gameId, ['playing']);
    requirePhase(g, 'attack', 'fortify');
    finishTurn(ctx, g, me);
  }
);

/** Quit a game in progress. Your territories stay on the board as neutral. */
export const forfeit = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const u = currentUser(ctx);
    const g = requireGame(ctx, gameId);
    if (!['claim', 'deploy', 'playing'].includes(g.status))
      throw new SenderError('The game is not in progress');
    const me = findPlayer(ctx, gameId, u.id);
    if (!me || me.eliminated) throw new SenderError('You are not playing in this game');

    for (const tr of territoriesOf(ctx, gameId))
      if (tr.ownerSeat === me.seat) ctx.db.territory.id.update({ ...tr, ownerSeat: -1 });
    eliminate(ctx, gameId, me, null);
    ctx.db.gamePlayer.id.update({ ...ctx.db.gamePlayer.id.find(me.id)!, forfeited: true });
    log(ctx, gameId, `${me.username} forfeited. Their territories are now neutral.`);

    if (checkForWinner(ctx, gameId)) return;
    if (g.currentSeat !== me.seat) return;
    if (g.status === 'playing') beginTurn(ctx, gameId, nextAliveSeat(ctx, g, me.seat));
    else advanceSetup(ctx, gameId);
  }
);

// ─── Views ─────────────────────────────────────────────────────────────────

/** The caller's own hand of RISK cards in their unfinished game(s). */
export const myCards = spacetimedb.view(
  { name: 'my_cards', public: true },
  t.array(card.rowType),
  ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s) return [];
    const out = [];
    for (const p of ctx.db.gamePlayer.userId.filter(s.userId)) {
      if (p.eliminated) continue;
      for (const c of ctx.db.card.by_game_holder.filter([p.gameId, p.seat]))
        if (c.location === 'hand') out.push(c);
    }
    return out;
  }
);

