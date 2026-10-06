# Riskish

A multiplayer take on the classic RISK board game (World Domination rules), built
with a SpacetimeDB TypeScript module and a React client.

## Features

- **Accounts**: register and log in with a username and password. Passwords are
  salted and hashed inside the module and stored in a private table. Logging in
  from another browser links that browser's identity to the same account.
- **Lobby**: create a game and wait for others, or join an open game. A game
  starts automatically when 6 players have joined, or when its creator presses
  **Start game** with at least 2 players. You can watch games in progress, and
  the lobby shows who is online and a leaderboard.
- **Gameplay** follows `risk-rules.pdf`:
  - Setup: players take turns claiming the 42 territories, then deploying the rest
    of their starting armies (35/30/25/20 each for 3/4/5/6 players).
  - Each turn has three steps. **Reinforce**: territories ÷ 3 (at least 3), plus
    continent bonuses, plus card sets. **Attack**: 1-3 dice against 1-2, with
    ties going to the defender. **Fortify**: one move between two adjacent
    territories you own.
  - Cards: you earn one card per turn in which you captured a territory. Set values
    go 4, 6, 8, 10, 12, 15, then +5 for each further set. If a traded card shows a
    territory you hold, you get +2 armies there. Holding 5 or more cards forces a
    trade. When you eliminate a player you take their cards, and if that leaves
    you with 6 or more you must trade down to 4.
  - 2-player variant: 14 territories each, plus 14 neutral territories that hold
    40 neutral armies.
  - **Blitz** keeps rolling until the territory falls or your attacking territory
    has only 1 army left.
  - **Forfeit** leaves a game in progress. The forfeiting player's territories
    become neutral.
- **Chat**: a global channel for all users, plus a channel for each game. Only
  the game's players can post in a game channel. The game channel and all of the
  game's board data are deleted when the game ends.

## Project layout

```
spacetimedb/src/index.ts     # module: tables, reducers, my_cards view
spacetimedb/src/riskMap.ts   # territories, adjacency, continents, card rules (shared with the client)
spacetimedb/src/sha256.ts    # password hashing (the module runtime has no WebCrypto)
src/App.tsx                  # auth gate, layout, routing between lobby and game
src/AuthScreen.tsx           # register / log in
src/Lobby.tsx                # create/join/watch games, online users, leaderboard
src/GameView.tsx             # waiting room, board interaction, cards, players, log
src/Board.tsx                # SVG world map
src/Chat.tsx                 # global + game chat
```

## Running locally

```bash
npm install
spacetime start                                  # in a separate terminal
npm run spacetime:publish:local -- --delete-data=always --yes
npm run spacetime:generate                       # only after changing the module
VITE_SPACETIMEDB_HOST=ws://localhost:3000 npm run dev
```

Open two different browsers, or a normal and a private window, to play against
yourself.

## Deploying to Maincloud

`.env.local` points the client at the `riskish-game` database on Maincloud.

```bash
npm run spacetime:publish -- --delete-data=always --yes   # first publish replaces the template schema
npm run dev
```

## Rule simplifications

- The defender always rolls the most dice allowed (2 if the territory has at
  least 2 armies). The defender is not asked to choose.
- The first player is chosen by a random seating order instead of a die roll.
- In 2-player games, the neutral armies are placed at random during setup. The
  players do not place them one at a time.
- There are no turn timers. A player who disconnects stalls the game until they
  return or forfeit.
