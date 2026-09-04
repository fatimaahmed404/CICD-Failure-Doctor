/**
 * Typed fetch helpers for all backend endpoints.
 *
 * Requirements covered: 8.1, 8.3, 13.1, 13.2, 17.1, 17.6, 17.8, 17.20
 */

import type {
  DiagnosisListResponse,
  DiagnosisDetail,
  SimulationScenario,
} from './types';

const CLIENT_ID_KEY = 'cicd-doctor-client-id';

/** Generate a simple UUID v4. */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create the anonymous client ID from localStorage.
 * Requirement: 13.1, 17.4
 */
export function getOrCreateClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = generateUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

const getApiBaseUrl = (): string =>
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/** Generic fetch wrapper. */
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Network error: ${String(error)}`);
  }
}

// ── Diagnoses ─────────────────────────────────────────────────────────────────

export async function fetchDiagnoses(
  page = 1,
  limit = 20,
  category?: string,
): Promise<DiagnosisListResponse> {
  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
  if (category) params.append('category', category);
  return apiFetch<DiagnosisListResponse>(`/diagnoses?${params.toString()}`);
}

export async function fetchDiagnosisById(id: string): Promise<DiagnosisDetail> {
  return apiFetch<DiagnosisDetail>(`/diagnoses/${id}`);
}

export async function postSimulate(
  scenario?: SimulationScenario,
): Promise<{ id: string; scenario: SimulationScenario; status: 'pending' }> {
  return apiFetch<{ id: string; scenario: SimulationScenario; status: 'pending' }>(
    '/simulate',
    { method: 'POST', body: JSON.stringify(scenario ? { scenario } : {}) },
  );
}

export async function postFeedback(
  diagnosisId: string,
  clientId: string,
  rating: 'helpful' | 'unhelpful',
): Promise<{
  id: string;
  buildRecordId: string;
  clientId: string;
  rating: 'helpful' | 'unhelpful';
  createdAt: string;
}> {
  return apiFetch(`/diagnoses/${diagnosisId}/feedback`, {
    method: 'POST',
    headers: { 'X-Client-Id': clientId },
    body: JSON.stringify({ rating }),
  });
}

// ── Config (Req 17.1, 17.2) ───────────────────────────────────────────────────

export interface AppConfig {
  features: {
    githubOAuth: boolean;
  };
}

export async function fetchConfig(): Promise<AppConfig> {
  return apiFetch<AppConfig>('/config');
}

// ── GitHub OAuth (Req 17.6, 17.8, 17.20) ─────────────────────────────────────

export interface GitHubRepo {
  name: string;
  full_name: string;
  default_branch: string;
  html_url: string;
}

export interface ConnectRepoResponse {
  success: true;
  repoFullName: string;
  workflowUrl: string;
}

export interface ConnectRepoPartialResponse {
  secretsCreated: true;
  workflowError: string;
  repoFullName: string;
  manualSetupUrl: string;
  message: string;
}

export interface GitHubStatusResponse {
  connected: boolean;
  githubUsername?: string | null;
}

/** Fetch repositories where the user has push access. Req 17.6 */
export async function fetchGitHubRepos(clientId: string): Promise<GitHubRepo[]> {
  return apiFetch<GitHubRepo[]>('/github/repos', {
    headers: { 'X-Client-Id': clientId },
  });
}

/** Connect a repository. Req 17.8 */
export async function connectRepo(
  clientId: string,
  repoFullName: string,
): Promise<ConnectRepoResponse | ConnectRepoPartialResponse> {
  return apiFetch<ConnectRepoResponse | ConnectRepoPartialResponse>(
    '/github/connect-repo',
    {
      method: 'POST',
      headers: { 'X-Client-Id': clientId },
      body: JSON.stringify({ repoFullName }),
    },
  );
}

/**
 * Alias for connectRepo — handles 200 (full success) and 207 (partial success) differently.
 * Req 17.8, 17.9
 */
export async function connectGitHubRepo(
  clientId: string,
  repoFullName: string,
): Promise<ConnectRepoResponse | ConnectRepoPartialResponse> {
  return connectRepo(clientId, repoFullName);
}

/** Disconnect GitHub account. Req 17.20 */
export async function disconnectGitHub(clientId: string): Promise<void> {
  await apiFetch('/github/disconnect', {
    method: 'DELETE',
    headers: { 'X-Client-Id': clientId },
  });
}

/** Check connection status. */
export async function fetchGitHubStatus(clientId: string): Promise<GitHubStatusResponse> {
  return apiFetch<GitHubStatusResponse>('/github/status', {
    headers: { 'X-Client-Id': clientId },
  });
}
