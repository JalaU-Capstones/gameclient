export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface Gameplay {
  id: string;
  board: string[];
  status: 'waiting' | 'playing' | 'finished';
  winner: string | null;
  createdAt: string;
  updatedAt: string;
}
