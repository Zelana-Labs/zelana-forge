export interface Node {
  id: number;
  url: string;
  online: boolean;
  ready: boolean;
}

export interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  source: 'system' | 'setup' | 'prove' | 'verify';
}

export type ApiResponse<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

export interface ProofData {
  commitment: string;
  challenge: string;
  response: string;
  generator: string;
  public_key: string;
}

export interface SetupResponse {
  generator: string;
  public_key: string;
  num_nodes: number;
  threshold: number;
}
