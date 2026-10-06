import { useEffect, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import { AuthScreen } from './AuthScreen';
import { Lobby } from './Lobby';
import { GameView } from './GameView';
import { Chat } from './Chat';
import { useRun } from './actions';

const ACTIVE = ['lobby', 'claim', 'deploy', 'playing'];

function App() {
  const { isActive, identity, connectionError } = useSpacetimeDB();
  const [sessions, sessionsReady] = useTable(tables.session);
  const [users, usersReady] = useTable(tables.user);
  const [games] = useTable(tables.game);
  const [players] = useTable(tables.gamePlayer);
  const logout = useReducer(reducers.logout);
  const run = useRun();

  const mySession = identity ? sessions.find(s => s.identity.isEqual(identity)) : undefined;
  const me = mySession ? users.find(u => u.id === mySession.userId) : undefined;

  // The unfinished game I'm still alive in, if any.
  const activeGame = me
    ? games.find(
        g =>
          ACTIVE.includes(g.status) &&
          players.some(p => p.gameId === g.id && p.userId === me.id && !p.eliminated)
      )
    : undefined;

  const [viewGameId, setViewGameId] = useState<bigint | null>(null);
  useEffect(() => {
    if (activeGame) setViewGameId(activeGame.id);
  }, [activeGame?.id]);

  const viewed = viewGameId !== null ? games.find(g => g.id === viewGameId) : undefined;
  const viewedPlayers = viewed ? players.filter(p => p.gameId === viewed.id) : [];
  // The game chat follows the game on screen, or my active game while in the lobby.
  const chatGame = viewed ?? activeGame;
  const chatPlayers = chatGame ? players.filter(p => p.gameId === chatGame.id) : [];

  if (!isActive || !sessionsReady || !usersReady) {
    return (
      <div className="auth panel" style={{ textAlign: 'center' }}>
        <div className="title" style={{ color: 'var(--accent)', fontSize: 28, fontWeight: 800 }}>RISKISH</div>
        <p className="muted">{connectionError ? `Connection error: ${connectionError.message}` : 'Connecting…'}</p>
      </div>
    );
  }

  if (!me) return <AuthScreen />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">RISKISH</span>
        {viewed && (!activeGame || activeGame.id !== viewed.id || viewed.status === 'finished') && (
          <button className="small" onClick={() => setViewGameId(null)}>
            ← Lobby
          </button>
        )}
        {!viewed && activeGame && (
          <button className="small primary" onClick={() => setViewGameId(activeGame.id)}>
            Return to {activeGame.name}
          </button>
        )}
        <span className="spacer" />
        <span>
          <span className="dot on" style={{ marginRight: 6 }} />
          <strong>{me.username}</strong>{' '}
          <span className="muted">
            · {me.wins}W / {me.gamesPlayed}
          </span>
        </span>
        <button className="small" onClick={() => run(logout())}>
          Log out
        </button>
      </header>
      <div className="workspace">
        <main>
          {viewed ? (
            <GameView
              key={String(viewed.id)}
              game={viewed}
              players={viewedPlayers}
              me={me}
              users={users}
              onLeave={() => setViewGameId(null)}
            />
          ) : (
            <Lobby me={me} users={users} games={games} players={players} onView={setViewGameId} />
          )}
        </main>
        <Chat me={me} game={chatGame} players={chatPlayers} />
      </div>
    </div>
  );
}

export default App;
