export interface PublicUser {
  id: string;
  name: string;
}

export interface User extends PublicUser {
  email: string;
  registerDate: string;
}

export type UserResponse = User;

export type GameplayStatus = 'waiting' | 'playing' | 'finished';
export type MatchResultReason =
  | 'pending'
  | 'line'
  | 'draw'
  | 'abandon'
  | 'rejected'
  | 'expired'
  | 'host_left'
  | 'guest_left'
  | 'target_busy';

export type InvitationState =
  'pending' | 'queued' | 'accepted' | 'rejected' | 'expired' | 'canceled';

export interface MatchResult {
  winner: string | null;
  reason: MatchResultReason;
}

export interface Gameplay {
  id: string;
  currentPositions: string;
  hostPlayer: string;
  guestPlayer: string | null;
  playerTurn: string;
  invitationState: InvitationState;
  matchResult: MatchResult | null;
  createdDate: string;
  updatedDate: string;
}

export type GameplayResponse = Gameplay;

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogEntry {
  id: string;
  level: LogLevel;
  eventType: string;
  message: string;
  playerId: string | null;
  gameplayId: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  message?: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  password?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: UserResponse;
}
