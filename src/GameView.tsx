import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import type { Game, GamePlayer, User } from './module_bindings/types';
import {
  ADJACENCY,
  MIN_PLAYERS,
  NEUTRAL_COLOR,
  PLAYER_COLORS,
  SYMBOL_NAMES,
  TERRITORIES,
  WILD,
  isValidSet,
  setValue,
} from '../spacetimedb/src/riskMap.ts';
import { Board } from './Board';
import { useRun } from './actions';

interface Props {
  game: Game;
  players: readonly GamePlayer[];
  me: User;
  users: readonly User[];
  onLeave: () => void;
}

const PHASE_LABEL: Record<string, string> = {
  reinforce: 'Reinforce',
  attack: 'Attack',
  occupy: 'Occupy',
  fortify: 'Fortify',
};
const SYMBOL_ICON = ['🪖', '🐎', '💣', '★'];

export function GameView({ game, players, me, users, onLeave }: Props) {
  const gameId = game.id;
  const run = useRun();
  const [territoryRows] = useTable(tables.territory.where(r => r.gameId.eq(gameId)));
  const [logRows] = useTable(tables.gameLog.where(r => r.gameId.eq(gameId)));
  const [myCardRows] = useTable(tables.myCards);

  const setupPlace = useReducer(reducers.setupPlace);
  const placeArmies = useReducer(reducers.placeArmies);
  const tradeCards = useReducer(reducers.tradeCards);
  const finishReinforce = useReducer(reducers.finishReinforce);
  const attack = useReducer(reducers.attack);
  const occupy = useReducer(reducers.occupy);
  const endAttack = useReducer(reducers.endAttack);
  const fortify = useReducer(reducers.fortify);
  const endTurn = useReducer(reducers.endTurn);
  const forfeit = useReducer(reducers.forfeit);
  const leaveGame = useReducer(reducers.leaveGame);
  const beginGame = useReducer(reducers.beginGame);

  const [selFrom, setSelFrom] = useState<number | null>(null);
  const [selTo, setSelTo] = useState<number | null>(null);
  const [placeStep, setPlaceStep] = useState<1 | 5 | 0>(1); // 0 = all
  const [dice, setDice] = useState(3);
  const [moveCount, setMoveCount] = useState(1);
  const [selectedCards, setSelectedCards] = useState<bigint[]>([]);

  const seated = useMemo(() => [...players].sort((a, b) => a.seat - b.seat), [players]);
  const terrs = useMemo(() => {
    const arr = new Array(TERRITORIES.length);
    for (const t of territoryRows) arr[t.idx] = t;
    return arr as (typeof territoryRows)[number][];
  }, [territoryRows]);
  const hand = myCardRows.filter(c => c.gameId === gameId);
  const logs = useMemo(
    () =>
      [...logRows].sort((a, b) =>
        a.at.microsSinceUnixEpoch === b.at.microsSinceUnixEpoch
          ? Number(a.id - b.id)
          : Number(a.at.microsSinceUnixEpoch - b.at.microsSinceUnixEpoch)
      ),
    [logRows]
  );

  const mine = players.find(p => p.userId === me.id);
  const current = seated.find(p => p.seat === game.currentSeat);
  const inProgress = ['claim', 'deploy', 'playing'].includes(game.status);
  const myTurn = !!mine && !mine.eliminated && inProgress && game.currentSeat === mine.seat;
  const playing = game.status === 'playing';
  const phase = playing ? game.phase : game.status;

  const colorForSeat = (seat: number) => seated.find(p => p.seat === seat)?.color || PLAYER_COLORS[seat];
  const ownedBy = (idx: number, seat: number | undefined) => terrs[idx]?.ownerSeat === seat;
  const isUnclaimed = (idx: number) => terrs[idx]?.ownerSeat === -1 && terrs[idx]?.armies === 0;

  // Reset selections whenever the turn or phase moves on.
  useEffect(() => {
    setSelFrom(null);
    setSelTo(null);
    setSelectedCards([]);
  }, [game.currentSeat, game.phase, game.status, game.turnNumber]);

  // Drop selections that are no longer valid (e.g. source ran out of armies).
  const from = selFrom !== null && ownedBy(selFrom, mine?.seat) && terrs[selFrom].armies >= 2 ? selFrom : null;
  const to =
    from !== null && selTo !== null && ADJACENCY[from].includes(selTo) &&
    (phase === 'attack' ? !ownedBy(selTo, mine?.seat) : ownedBy(selTo, mine?.seat))
      ? selTo
      : null;

  const maxDice = from !== null ? Math.min(3, terrs[from].armies - 1) : 3;
  const maxMove = phase === 'occupy' ? (terrs[game.occupyFrom]?.armies ?? 1) - 1 : from !== null ? terrs[from].armies - 1 : 0;

  useEffect(() => {
    setMoveCount(phase === 'occupy' ? maxMove : Math.max(1, maxMove));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, from, to, game.occupyTo]);

  // ── Board interactivity ─────────────────────────────────────
  const clickable = new Set<number>();
  const targets = new Set<number>();
  if (myTurn && terrs.length && mine) {
    TERRITORIES.forEach((_, idx) => {
      if (!terrs[idx]) return;
      if (phase === 'claim' && isUnclaimed(idx)) clickable.add(idx);
      if (phase === 'deploy' && mine.armiesToPlace > 0 && ownedBy(idx, mine.seat)) clickable.add(idx);
      if (phase === 'reinforce' && game.reinforcements > 0 && mine.cardCount < 5 && ownedBy(idx, mine.seat))
        clickable.add(idx);
      if ((phase === 'attack' || phase === 'fortify') && ownedBy(idx, mine.seat) && terrs[idx].armies >= 2) {
        const hasTarget = ADJACENCY[idx].some(n =>
          phase === 'attack' ? !ownedBy(n, mine.seat) : ownedBy(n, mine.seat)
        );
        if (hasTarget) clickable.add(idx);
      }
    });
    if (from !== null) {
      for (const n of ADJACENCY[from]) {
        const ok = phase === 'attack' ? !ownedBy(n, mine.seat) : ownedBy(n, mine.seat);
        if (ok) {
          targets.add(n);
          clickable.add(n);
        }
      }
    }
  }

  const onTerritoryClick = (idx: number) => {
    if (phase === 'claim' || phase === 'deploy') {
      run(setupPlace({ gameId, territory: idx }));
    } else if (phase === 'reinforce') {
      const count = placeStep === 0 ? game.reinforcements : Math.min(placeStep, game.reinforcements);
      run(placeArmies({ gameId, territory: idx, count }));
    } else if (phase === 'attack' || phase === 'fortify') {
      if (targets.has(idx)) setSelTo(idx);
      else {
        setSelFrom(idx === from ? null : idx);
        setSelTo(null);
      }
    }
  };

  const selected = new Set<number>();
  if (from !== null) selected.add(from);
  if (to !== null) selected.add(to);
  if (phase === 'occupy') {
    selected.add(game.occupyFrom);
    selected.add(game.occupyTo);
  }

  // ── Stats ───────────────────────────────────────────────────
  const statsFor = (seat: number) => {
    let count = 0;
    let armies = 0;
    for (const t of terrs) if (t && t.ownerSeat === seat) {
      count++;
      armies += t.armies;
    }
    return { count, armies };
  };

  const selectedCardRows = hand.filter(c => selectedCards.includes(c.id));
  const canTrade =
    myTurn && phase === 'reinforce' && selectedCardRows.length === 3 &&
    isValidSet(selectedCardRows.map(c => c.symbol)) && !(game.forcedTrade && (mine?.cardCount ?? 0) <= 4);

  const toggleCard = (id: bigint) =>
    setSelectedCards(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= 3 ? s : [...s, id]));

  const name = (idx: number) => TERRITORIES[idx].name;

  // ── Render: waiting room ────────────────────────────────────
  if (game.status === 'lobby') {
    const isCreator = game.creatorId === me.id;
    return (
      <div className="panel stack" style={{ maxWidth: 640 }}>
        <div className="row">
          <h2 style={{ flex: 1 }}>{game.name}</h2>
          <span className="muted">Waiting for players · {players.length} / 6</span>
        </div>
        <ul className="list">
          {[...players]
            .sort((a, b) => Number(a.joinedAt.microsSinceUnixEpoch - b.joinedAt.microsSinceUnixEpoch))
            .map(p => (
              <li key={String(p.id)}>
                <span className={`dot ${users.find(u => u.id === p.userId)?.online ? 'on' : ''}`} />
                {p.username}
                {p.userId === game.creatorId && <span className="muted">(host)</span>}
              </li>
            ))}
        </ul>
        <p className="muted" style={{ margin: 0 }}>
          The game begins automatically when 6 players have joined.
          {isCreator ? ' As host, you can start now once at least 2 players are here.' : ' The host can also start it early.'}
        </p>
        <div className="row">
          {isCreator && (
            <button
              className="primary"
              disabled={players.length < MIN_PLAYERS}
              onClick={() => run(beginGame({ gameId }))}
            >
              Start game
            </button>
          )}
          {mine && (
            <button className="danger" onClick={() => run(leaveGame({ gameId })).then(ok => ok && onLeave())}>
              Leave game
            </button>
          )}
          {!mine && <button onClick={onLeave}>Back to lobby</button>}
        </div>
      </div>
    );
  }

  // ── Render: action panel ────────────────────────────────────
  const actionPanel = () => {
    if (game.status === 'finished') return null;
    if (!mine || mine.eliminated) {
      return <div className="hint">{mine?.eliminated ? 'You have been eliminated. You can keep watching.' : 'You are spectating.'}</div>;
    }
    if (!myTurn) {
      return (
        <div className="hint">
          Waiting for <strong style={{ color: current?.color }}>{current?.username}</strong>
          {playing ? ` (${PHASE_LABEL[game.phase] ?? game.phase})` : ''}…
        </div>
      );
    }
    switch (phase) {
      case 'claim':
        return <div className="hint">Your turn: click an <strong>unclaimed</strong> territory to claim it. ({mine.armiesToPlace} armies left)</div>;
      case 'deploy':
        return <div className="hint">Your turn: click one of your territories to add an army. ({mine.armiesToPlace} armies left)</div>;
      case 'reinforce':
        return (
          <>
            <div className="big">{game.reinforcements} armies to place</div>
            {mine.cardCount >= 5 ? (
              <div className="hint" style={{ color: 'var(--danger)' }}>
                You hold {mine.cardCount} cards and must trade in a set before placing armies.
              </div>
            ) : (
              <div className="hint">Click your territories to place armies.</div>
            )}
            <div className="row">
              <span className="muted">Per click:</span>
              <div className="seg">
                {([1, 5, 0] as const).map(s => (
                  <button key={s} className={placeStep === s ? 'active' : ''} onClick={() => setPlaceStep(s)}>
                    {s === 0 ? 'All' : s}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="primary"
              disabled={game.reinforcements > 0 || mine.cardCount >= 5}
              onClick={() => run(finishReinforce({ gameId }))}
            >
              Done → Attack
            </button>
          </>
        );
      case 'attack':
        return (
          <>
            <div className="hint">
              {from === null
                ? 'Select one of your territories (2+ armies) to attack from.'
                : to === null
                  ? `Attacking from ${name(from)}. Select an adjacent enemy territory.`
                  : (
                    <>
                      <strong>{name(from)}</strong> ({terrs[from].armies}) ⚔ <strong>{name(to)}</strong> ({terrs[to].armies})
                    </>
                  )}
            </div>
            {to !== null && from !== null && (
              <>
                <div className="row">
                  <span className="muted">Dice:</span>
                  <div className="seg">
                    {[1, 2, 3].map(d => (
                      <button key={d} disabled={d > maxDice} className={Math.min(dice, maxDice) === d ? 'active' : ''} onClick={() => setDice(d)}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="row">
                  <button className="primary" onClick={() => run(attack({ gameId, from, to, dice: Math.min(dice, maxDice), blitz: false }))}>
                    Roll
                  </button>
                  <button
                    title="Keep rolling until the territory falls or you have 1 army left"
                    onClick={() => run(attack({ gameId, from, to, dice: Math.min(dice, maxDice), blitz: true }))}
                  >
                    Blitz
                  </button>
                </div>
              </>
            )}
            <div className="row">
              <button onClick={() => run(endAttack({ gameId }))}>Stop attacking → Fortify</button>
              <button onClick={() => run(endTurn({ gameId }))}>End turn</button>
            </div>
          </>
        );
      case 'occupy':
        return (
          <>
            <div className="hint">
              You captured <strong>{name(game.occupyTo)}</strong>! Move additional armies in from {name(game.occupyFrom)}.
            </div>
            <input type="range" min={0} max={maxMove} value={moveCount} onChange={e => setMoveCount(Number(e.target.value))} />
            <div className="row">
              <span className="big" style={{ fontSize: 18 }}>+{moveCount}</span>
              <button className="primary" onClick={() => run(occupy({ gameId, count: moveCount }))}>
                Move in
              </button>
            </div>
          </>
        );
      case 'fortify':
        return (
          <>
            <div className="hint">
              {from === null
                ? 'Optionally move armies between two adjacent territories you own, then your turn ends.'
                : to === null
                  ? `Moving from ${name(from)}. Select an adjacent territory you own.`
                  : `Move armies from ${name(from)} to ${name(to)}.`}
            </div>
            {from !== null && to !== null && (
              <>
                <input type="range" min={1} max={maxMove} value={moveCount} onChange={e => setMoveCount(Number(e.target.value))} />
                <button className="primary" onClick={() => run(fortify({ gameId, from, to, count: moveCount }))}>
                  Move {moveCount} & end turn
                </button>
              </>
            )}
            <button onClick={() => run(endTurn({ gameId }))}>End turn</button>
          </>
        );
    }
    return null;
  };

  const battle = game.lastBattle;

  return (
    <div className="game">
      <div className="stack">
        {game.status === 'finished' && (
          <div className="banner">
            <span style={{ fontSize: 28 }}>🏆</span>
            <div style={{ flex: 1 }}>
              <div className="big">{game.winnerName} conquered the world!</div>
              <div className="muted">The game is over and its chat channel has been closed.</div>
            </div>
            <button className="primary" onClick={onLeave}>Back to lobby</button>
          </div>
        )}
        <div className="board-wrap">
          <div className="statusbar">
            <strong>{game.name}</strong>
            {inProgress && (
              <>
                <span className="muted">·</span>
                <span className="turn" style={{ color: current?.color }}>
                  {myTurn ? 'Your turn' : `${current?.username}'s turn`}
                </span>
                <span className="muted">
                  {playing ? `Turn ${game.turnNumber} · ${PHASE_LABEL[game.phase] ?? game.phase}` : game.status === 'claim' ? 'Setup · claim territories' : 'Setup · deploy armies'}
                </span>
              </>
            )}
            <span style={{ flex: 1 }} />
            <span className="muted" title="Armies awarded for the next matched card set">
              Next set: {setValue(game.setsTraded + 1)}
            </span>
          </div>
          <Board
            territories={territoryRows}
            colorForSeat={colorForSeat}
            clickable={clickable}
            selected={selected}
            targets={targets}
            onClick={onTerritoryClick}
          />
        </div>

        {mine && !mine.eliminated && inProgress && (
          <div className="panel stack">
            <div className="row">
              <h3 style={{ flex: 1 }}>Your RISK cards ({hand.length})</h3>
              <button className="primary small" disabled={!canTrade} onClick={() => run(tradeCards({ gameId, cardIds: selectedCards }))}>
                Trade set for {setValue(game.setsTraded + 1)}
              </button>
            </div>
            {hand.length === 0 ? (
              <span className="muted">Capture a territory during your turn to earn a card.</span>
            ) : (
              <div className="hand">
                {hand.map(c => (
                  <div
                    key={String(c.id)}
                    className={`risk-card${c.symbol === WILD ? ' wild' : ''}${selectedCards.includes(c.id) ? ' selected' : ''}`}
                    onClick={() => toggleCard(c.id)}
                    title={c.territoryIdx >= 0 ? `${TERRITORIES[c.territoryIdx].name} – ${SYMBOL_NAMES[c.symbol]}` : 'Wild card'}
                  >
                    <span>{c.territoryIdx >= 0 ? TERRITORIES[c.territoryIdx].name : 'WILD'}</span>
                    <span className="icon">{SYMBOL_ICON[c.symbol]}</span>
                    <span>{SYMBOL_NAMES[c.symbol]}</span>
                  </div>
                ))}
              </div>
            )}
            <span className="muted" style={{ fontSize: 12 }}>
              Sets: 3 of a kind, one of each, or any 2 + wild. Trade at the start of your turn; 5+ cards forces a trade.
              If a traded card shows a territory you hold, +2 armies go there.
            </span>
          </div>
        )}
      </div>

      <div className="stack">
        <div className="panel actions">
          <h3>Actions</h3>
          {actionPanel()}
          {battle && playing && (
            <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Last battle: {name(battle.from)} → {name(battle.to)}
                {battle.rolls > 1 ? ` (${battle.rolls} rolls)` : ''}
              </span>
              <div className="row">
                <div className="dice">
                  {Array.from(battle.attackerDice).map((d, i) => <span key={i} className="die att">{d}</span>)}
                </div>
                <span className="muted">vs</span>
                <div className="dice">
                  {Array.from(battle.defenderDice).map((d, i) => <span key={i} className="die def">{d}</span>)}
                </div>
              </div>
              <span style={{ fontSize: 12 }}>
                Attacker −{battle.attackerLosses}, defender −{battle.defenderLosses}
                {battle.captured ? ' · territory captured!' : ''}
              </span>
            </div>
          )}
        </div>

        <div className="panel stack">
          <h3>Players</h3>
          <div className="players">
            {seated.map(p => {
              const s = statsFor(p.seat);
              const online = users.find(u => u.id === p.userId)?.online;
              return (
                <div key={String(p.id)} className={`player${p.seat === game.currentSeat && inProgress ? ' current' : ''}${p.eliminated ? ' out' : ''}`}>
                  <span className="swatch" style={{ background: p.color }} />
                  <span>
                    <span className={`dot ${online ? 'on' : ''}`} style={{ marginRight: 6 }} />
                    {p.username}
                    {p.userId === me.id && <span className="muted"> (you)</span>}
                    {p.eliminated && <span className="muted"> {p.forfeited ? '· forfeited' : '· eliminated'}</span>}
                  </span>
                  <span className="stats">
                    {inProgress && !p.eliminated
                      ? `${s.count} territories · ${s.armies} armies · ${p.cardCount} cards${game.status !== 'playing' ? ` · ${p.armiesToPlace} to place` : ''}`
                      : ''}
                  </span>
                </div>
              );
            })}
            {terrs.some(t => t && t.ownerSeat === -1 && t.armies > 0) && (
              <div className="player">
                <span className="swatch" style={{ background: NEUTRAL_COLOR }} />
                <span>Neutral</span>
                <span className="stats">
                  {statsFor(-1).count} territories · {terrs.reduce((a, t) => a + (t && t.ownerSeat === -1 ? t.armies : 0), 0)} armies
                </span>
              </div>
            )}
          </div>
          {mine && !mine.eliminated && inProgress && (
            <button
              className="danger small"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                if (confirm('Forfeit this game? Your territories will become neutral.')) run(forfeit({ gameId }));
              }}
            >
              Forfeit
            </button>
          )}
          {(!mine || mine.eliminated) && game.status !== 'finished' && (
            <button className="small" style={{ alignSelf: 'flex-start' }} onClick={onLeave}>
              Back to lobby
            </button>
          )}
        </div>

        {logs.length > 0 && (
          <div className="panel stack">
            <h3>Game log</h3>
            <GameLogList entries={logs.map(l => ({ id: l.id, text: l.text }))} />
          </div>
        )}
      </div>
    </div>
  );
}

function GameLogList({ entries }: { entries: { id: bigint; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [entries.length]);
  return (
    <div className="log" ref={ref}>
      {entries.map(e => (
        <div key={String(e.id)}>{e.text}</div>
      ))}
    </div>
  );
}
