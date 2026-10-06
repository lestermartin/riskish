import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from './module_bindings';
import { useRun } from './actions';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useRun();
  const register = useReducer(reducers.register);
  const login = useReducer(reducers.login);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    await run(
      mode === 'register' ? register({ username, password }) : login({ username, password })
    );
    setBusy(false);
  };

  return (
    <div className="auth panel">
      <div className="title">RISKISH</div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
        The game of global domination
      </p>
      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Log in
        </button>
        <button
          className={mode === 'register' ? 'active' : ''}
          onClick={() => setMode('register')}
        >
          Register
        </button>
      </div>
      <form onSubmit={submit}>
        <input
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          maxLength={20}
          required
        />
        <input
          placeholder="Password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        {mode === 'register' && (
          <>
            <input
              placeholder="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
            />
            <span className="muted" style={{ fontSize: 12 }}>
              3-20 characters (letters, numbers, _ or -); password of 6+ characters.
            </span>
          </>
        )}
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        <button className="primary" type="submit" disabled={busy}>
          {mode === 'register' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
