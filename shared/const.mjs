export const GRID = 7;
export const LAYERS_PER_LEVEL = 10;
export const TICK_HZ = 20;
export const MAX_PLAYERS = 16;
export const START_LIVES = 3;
export const MOVE_COOLDOWN_MS = 90;
export const INVULN_MS = 2000;

export const BASE_FALL_SPEED = 0.8;
export const FALL_SPEED_PER_LEVEL = 0.09;
export const MAX_FALL_SPEED = 3.2;

export const VIEW_AHEAD = 24;
export const GEN_AHEAD = 48;

export const CELL = {
  EMPTY: '.',
  WALL: '#',
  HAZARD: '^',
  COIN: '$',
  GEM: '*'
};

export const SCORE = {
  COIN_GOLD: 10,
  COIN: 10,
  GEM: 50,
  DEPTH_PER_LEVEL: 100,
  SURVIVAL_PER_LEVEL: 500
};

export const PLAYER_COLORS = [
  '#ff3df0', '#2bfcff', '#ffe93d', '#3dff6e',
  '#ff8a3d', '#8a6bff', '#ff4d5e', '#5effc3',
  '#ffb3f5', '#9bd7ff', '#fff3a1', '#b6ffb0',
  '#ffc98a', '#c9b8ff', '#ff9aa5', '#a1ffe8'
];
