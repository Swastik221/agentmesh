export interface HealthStatus {
  status: string;
  service: string;
  database: 'connected' | 'disconnected';
}
