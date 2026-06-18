export type GameType = '501' | '301' | 'Cricket' | 'AroundTheClock';
export type MatchStatus = 'in_progress' | 'completed';

export interface Player {
  id: string; // uuid
  name: string;
  createdAt: number; // Date.now()
}

export interface DartThrow {
  score: number; // numeric value (e.g. 60)
  label: string; // display label (e.g. "T20", "Bull", "Miss")
  isDouble: boolean; // needed for double-out validation
}

export interface Turn {
  playerId: string;
  darts: DartThrow[]; // always 3 (or fewer if match won mid-turn)
  totalScore: number; // sum of darts in this turn
  remainingScore: number; // score left after this turn
  isBust: boolean;
  timestamp: number;
}

export interface Leg {
  id: string;
  matchId: string;
  winnerId: string | null;
  turns: Turn[];
}

export interface Match {
  id: string;
  date: number;
  gameType: GameType;
  playerIds: string[];
  winnerId: string | null;
  format: {
    legs: number; // e.g. 3 = best of 3
    sets: number; // e.g. 1 for no sets
  };
  doubleOut: boolean;
  status: MatchStatus;
  legs: Leg[];
}

/** Bundle returned by export / accepted by import. */
export interface ExportBundle {
  players: Player[];
  matches: Match[];
}
