export type GameType = '501' | '301' | 'Cricket' | 'AroundTheClock' | 'Training';
export type MatchStatus = 'in_progress' | 'completed';

/**
 * Around the Clock scoring variant:
 * - single / double / triple: the required ring; play is hit/miss, +1 per hit.
 * - progressive: any ring hits, but the multiplier advances extra — a double
 *   moves you +2 targets and a treble +3 (single +1).
 * Stored on the match so analytics can separate variants.
 */
export type AtcRing = 'single' | 'double' | 'triple' | 'progressive';

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
  atcRing?: AtcRing; // only set for Around the Clock matches
  // Training mode only: the live target, the remainder of the shuffle bag,
  // and the next round's pre-dealt order — persisted so a reload never
  // reshuffles mid-bag (nextBag is optional: pre-wheel records lack it).
  training?: { target: string; bag: string[]; nextBag?: string[] };
  status: MatchStatus;
  legs: Leg[];
}

/** Bundle returned by export / accepted by import. */
export interface ExportBundle {
  // Schema version of the bundle. Absent on backups made before versioning
  // was introduced — those are treated as version 1.
  version?: number;
  players: Player[];
  matches: Match[];
}
