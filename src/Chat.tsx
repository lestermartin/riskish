import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import type { ChatMessage, Game, GamePlayer, User } from './module_bindings/types';
import { useRun } from './actions';

interface Props {
  me: User;
  /** Game whose channel is offered, if any (not finished). */
  game: Game | undefined;
  players: readonly GamePlayer[];
}

const GLOBAL = 0n;

function sortMessages(rows: readonly ChatMessage[]) {
  return [...rows].sort((a, b) => {
    const d = a.sentAt.microsSinceUnixEpoch - b.sentAt.microsSinceUnixEpoch;
    return d !== 0n ? (d < 0n ? -1 : 1) : a.id < b.id ? -1 : 1;
  });
}

export function Chat({ me, game, players }: Props) {
  const gameId = game && game.status !== 'finished' ? game.id : undefined;
  const [tab, setTab] = useState<'global' | 'game'>('global');
  const [globalRows] = useTable(tables.chatMessage.where(r => r.gameId.eq(GLOBAL)));
  const [gameRows] = useTable(tables.chatMessage.where(r => r.gameId.eq(gameId ?? GLOBAL)), {
    enabled: gameId !== undefined,
  });

  // Jump to the game channel when a game is opened; fall back when it closes.
  useEffect(() => {
    setTab(gameId !== undefined ? 'game' : 'global');
  }, [gameId]);

  const active = tab === 'game' && gameId !== undefined ? 'game' : 'global';
  const messages = useMemo(
    () => sortMessages(active === 'game' ? gameRows : globalRows),
    [active, gameRows, globalRows]
  );

  // Unread counters for the tab that is not showing.
  const [seen, setSeen] = useState({ global: 0, game: 0 });
  useEffect(() => {
    setSeen(s => ({ ...s, [active]: active === 'game' ? gameRows.length : globalRows.length }));
  }, [active, gameRows.length, globalRows.length]);
  useEffect(() => setSeen(s => ({ ...s, game: 0 })), [gameId]);
  const unreadGlobal = active === 'global' ? 0 : Math.max(0, globalRows.length - seen.global);
  const unreadGame = active === 'game' ? 0 : Math.max(0, gameRows.length - seen.game);

  const isMember = gameId !== undefined && players.some(p => p.gameId === gameId && p.userId === me.id);
  const canSend = active === 'global' || isMember;

  const [text, setText] = useState('');
  const run = useRun();
  const sendChat = useReducer(reducers.sendChat);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(sendChat({ gameId: active === 'game' ? gameId! : GLOBAL, text }))) setText('');
  };

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, active]);

  const colorOf = (userId: bigint) =>
    active === 'game' ? players.find(p => p.gameId === gameId && p.userId === userId)?.color : undefined;

  return (
    <aside className="panel chat">
      <div className="tabs">
        <button className={active === 'global' ? 'active' : ''} onClick={() => setTab('global')}>
          🌐 Global
          {unreadGlobal > 0 && <span className="badge">{unreadGlobal}</span>}
        </button>
        {gameId !== undefined && (
          <button className={active === 'game' ? 'active' : ''} onClick={() => setTab('game')}>
            ⚔ {game!.name.length > 16 ? `${game!.name.slice(0, 15)}…` : game!.name}
            {unreadGame > 0 && <span className="badge">{unreadGame}</span>}
          </button>
        )}
      </div>
      <div className="messages" ref={listRef}>
        {messages.length === 0 && (
          <span className="muted">
            {active === 'game' ? 'Game channel — only players in this game can post here.' : 'Say hello to everyone!'}
          </span>
        )}
        {messages.map(m =>
          m.userId === 0n ? (
            <div key={String(m.id)} className="msg system">
              {m.text}
            </div>
          ) : (
            <div key={String(m.id)} className="msg">
              <span className="who" style={{ color: colorOf(m.userId) ?? (m.userId === me.id ? 'var(--accent)' : undefined) }}>
                {m.username}
              </span>
              {m.text}
              <span className="time">
                {new Date(Number(m.sentAt.microsSinceUnixEpoch / 1000n)).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          )
        )}
      </div>
      <form onSubmit={send}>
        <input
          value={text}
          maxLength={500}
          disabled={!canSend}
          placeholder={canSend ? (active === 'game' ? 'Message your opponents…' : 'Message everyone…') : 'Spectators cannot post'}
          onChange={e => setText(e.target.value)}
        />
        <button className="primary" type="submit" disabled={!canSend || !text.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
