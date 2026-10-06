import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from './module_bindings';
import type { Game, GamePlayer, User } from './module_bindings/types';
import { MAX_PLAYERS } from '../spacetimedb/src/riskMap.ts';
import { useRun } from './actions';

interface Props {
  me: User;
  users: readonly User[];
  games: readonly Game[];
  players: readonly GamePlayer[];
  onView: (gameId: bigint) => void;
}

const STATUS_LABEL: Record<string, string> = {
  claim: 'Claiming territories',
  deploy: 'Deploying armies',
  playing: 'In progress',
};

export function Lobby({ me, users, games, players, onView }: Props) {
  const [name, setName] = useState('');
  const run = useRun();
  const createGame = useReducer(reducers.createGame);
  const joinGame = useReducer(reducers.joinGame);

  const playersOf = (g: Game) => players.filter(p => p.gameId === g.id);
  const sortNewest = (a: Game, b: Game) =>
    Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch);
  const open = games.filter(g => g.status === 'lobby').sort(sortNewest);
  const running = games.filter(g => STATUS_LABEL[g.status]).sort(sortNewest);
  const finished = games
    .filter(g => g.status === 'finished')
    .sort(
      (a, b) =>
        Number((b.finishedAt?.microsSinceUnixEpoch ?? 0n) - (a.finishedAt?.microsSinceUnixEpoch ?? 0n))
    )
    .slice(0, 8);

  const online = users.filter(u => u.online).sort((a, b) => a.username.localeCompare(b.username));
  const leaders = [...users]
    .filter(u => u.gamesPlayed > 0)
    .sort((a, b) => b.wins - a.wins || a.gamesPlayed - b.gamesPlayed)
    .slice(0, 10);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(createGame({ name }))) setName('');
  };

  return (
    <div className="lobby">
      <div className="stack">
        <div className="panel stack">
          <h2>Start a new game</h2>
          <form className="row" onSubmit={create}>
            <input
              style={{ flex: 1 }}
              placeholder={`${me.username}'s game`}
              value={name}
              maxLength={40}
              onChange={e => setName(e.target.value)}
            />
            <button className="primary" type="submit">
              Create game
            </button>
          </form>
          <span className="muted" style={{ fontSize: 12 }}>
            Games start automatically when {MAX_PLAYERS} players have joined, or when the creator
            starts with 2 or more.
          </span>
        </div>

        <div className="panel stack">
          <h2>Open games ({open.length})</h2>
          {open.length === 0 && <span className="muted">No games are waiting for players. Create one!</span>}
          <div className="game-list">
            {open.map(g => {
              const ps = playersOf(g);
              const creator = users.find(u => u.id === g.creatorId);
              return (
                <div className="game-card" key={String(g.id)}>
                  <div className="info">
                    <div className="name">{g.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Hosted by {creator?.username ?? '?'} · {ps.map(p => p.username).join(', ')}
                    </div>
                  </div>
                  <div className="seats" title={`${ps.length} / ${MAX_PLAYERS} players`}>
                    {Array.from({ length: MAX_PLAYERS }, (_, i) => (
                      <span key={i} className={i < ps.length ? 'filled' : ''} />
                    ))}
                  </div>
                  <button className="primary" onClick={() => run(joinGame({ gameId: g.id }))}>
                    Join
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel stack">
          <h2>Games in progress ({running.length})</h2>
          {running.length === 0 && <span className="muted">None right now.</span>}
          <div className="game-list">
            {running.map(g => (
              <div className="game-card" key={String(g.id)}>
                <div className="info">
                  <div className="name">{g.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {STATUS_LABEL[g.status]}
                    {g.status === 'playing' && ` · turn ${g.turnNumber}`} ·{' '}
                    {playersOf(g)
                      .filter(p => !p.eliminated)
                      .map(p => p.username)
                      .join(', ')}
                  </div>
                </div>
                <button onClick={() => onView(g.id)}>Watch</button>
              </div>
            ))}
          </div>
        </div>

        {finished.length > 0 && (
          <div className="panel stack">
            <h2>Recently finished</h2>
            <ul className="list">
              {finished.map(g => (
                <li key={String(g.id)}>
                  <span>🏆</span>
                  <span>
                    <strong>{g.winnerName}</strong> won <em>{g.name}</em>
                  </span>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                    {g.playerCount} players
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="stack">
        <div className="panel stack">
          <h3>Online ({online.length})</h3>
          <ul className="list">
            {online.map(u => (
              <li key={String(u.id)}>
                <span className="dot on" />
                {u.username}
                {u.id === me.id && <span className="muted">(you)</span>}
              </li>
            ))}
          </ul>
        </div>
        <div className="panel stack">
          <h3>Leaderboard</h3>
          {leaders.length === 0 && <span className="muted">No finished games yet.</span>}
          <ul className="list">
            {leaders.map((u, i) => (
              <li key={String(u.id)}>
                <span className="muted" style={{ width: 18 }}>
                  {i + 1}.
                </span>
                <span style={{ flex: 1 }}>{u.username}</span>
                <span className="muted">
                  {u.wins}W / {u.gamesPlayed}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
