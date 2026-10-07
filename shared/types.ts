export type MonitorKind = 'ping' | 'http' | 'json';
export type ServiceStatus = 'operational' | 'down' | 'unknown' | 'maintenance';
export type CheckOutcome = 'up' | 'down' | 'unknown';
export type JsonOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists';
export interface JsonRule { path: string; operator: JsonOperator; value?: string | number | boolean | null }
export interface MonitorInput {
  group?: string; archived?: boolean;
  name: string; description: string; kind: MonitorKind; target: string;
  intervalSeconds: number; timeoutSeconds: number; failureThreshold: number; recoveryThreshold: number;
  enabled: boolean; maintenance: boolean; maintenanceUntil: number | null;
  method: 'GET' | 'HEAD' | 'POST'; headers: Record<string, string>; body: string;
  expectedStatus: number; rules: JsonRule[]; sortOrder: number;
}
export interface MonitorRecord extends MonitorInput {
  id: string; status: 'operational' | 'down' | 'unknown'; failures: number; successes: number;
  lastCheckAt: number | null; nextCheckAt: number; leaseUntil: number; revision: number;
}
export interface CheckResult {
  outcome: CheckOutcome; latencyMs: number | null; message: string;
}
export interface CheckRecord extends CheckResult { id: number; monitorId: string; checkedAt: number; intervalSeconds: number }
export interface Branding {
  title: string; description: string; logoUrl: string; faviconUrl: string; websiteUrl: string;
  brandColor: string; backgroundColor: string; operationalColor: string; downColor: string; maintenanceColor: string;
}
export interface SmtpSettings {
  enabled: boolean; host: string; port: number; security: 'tls' | 'starttls';
  username: string; password: string; from: string; recipients: string[];
}
export type SmtpView = Omit<SmtpSettings, 'password'> & { passwordSet: boolean; password?: string };
export interface DailyHistory { date: string; status: 'operational' | 'down' | 'unknown'; uptime: number | null }
export interface PublicMonitor {
  id: string; name: string; description: string; status: ServiceStatus;
  lastCheckAt: number | null; history: DailyHistory[];
}
export interface PublicIncident { id: string; monitorName: string; startedAt: number; resolvedAt: number | null; resolutionCause?: 'recovered' | 'configuration' }
export interface PublicStatus {
  branding: Branding; overall: ServiceStatus; monitors: PublicMonitor[];
  incidents: PublicIncident[]; updatedAt: number; lastCheckAt: number | null;
}
export interface AdminMonitor extends MonitorRecord { displayStatus: ServiceStatus; lastResult: CheckRecord | null }
export interface DeliveryRecord {
  id: string; kind: string; status: string; attempts: number; lastError: string | null; createdAt: number;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface IncidentCorrection { id: string; startedAt: number; endedAt: number; reason: string; createdAt: number; revokedAt: number | null; revokeReason: string | null }
export interface AdminIncident extends PublicIncident { monitorId: string; reason: string; corrected: number }
export interface IncidentDetail { incident: AdminIncident; corrections: IncidentCorrection[]; checks: Page<CheckRecord>; retentionCutoff: number | null }
