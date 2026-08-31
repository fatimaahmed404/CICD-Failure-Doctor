/**
 * Typed fetch helpers for all backend endpoints.
 * 
 * This module provides type-safe API client functions that communicate with the
 * CI/CD Failure Doctor backend. All functions use the base URL from VITE_API_BASE_URL
 * environment variable.
 * 
 * Requirements covered: 8.1 (API integration), 8.3 (simulate endpoint), 13.1, 13.2
 */

import type {
  DiagnosisListResponse,
  DiagnosisDetail,
  SimulationScenario,
} from './types';

const CLIENT_ID_KEY = 'cicd-doctor-client-id';

/**
 * Generate a simple UUID v4.
 * Used for anonymous client identification in localStorage.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create the anonymous client ID from localStorage.
 * This ID is used to associate feedback ratings with a browser/user.
 * 
 * Requirement: 13.1 (generate or retrieve cicd-doctor-client-id UUID from localStorage)
 */
export function getOrCreateClientId(): string {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  
  if (!clientId) {
    clientId = generateUUID();
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  
  return clientId;
}

/**
 * Get the API base URL from environment variables.
 * Defaults to http://localhost:3000 if not configured.
 */
const getApiBaseUrl = (): string => {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
};

/**
 * Generic fetch wrapper with error handling.
 * Throws an error with the response status and message if the request fails.
 */
async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
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
      throw new Error(
        `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Network error: ${String(error)}`);
  }
}

/**
 * Fetch paginated list of diagnoses.
 * 
 * @param page - Page number (1-indexed)
 * @param limit - Number of items per page (default 20, max 100)
 * @param category - Optional failure category filter
 * @returns Paginated list of diagnosis summaries
 * 
 * Maps to: GET /diagnoses?page=1&limit=20&category=test-failure
 */
export async function fetchDiagnoses(
  page = 1,
  limit = 20,
  category?: string
): Promise<DiagnosisListResponse> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });

  if (category) {
    params.append('category', category);
  }

  return apiFetch<DiagnosisListResponse>(`/diagnoses?${params.toString()}`);
}

/**
 * Fetch a single diagnosis by ID.
 * 
 * @param id - The diagnosis record ID (UUID)
 * @returns Full diagnosis detail including raw log and suggested fix
 * @throws Error if the diagnosis is not found (404)
 * 
 * Maps to: GET /diagnoses/:id
 */
export async function fetchDiagnosisById(id: string): Promise<DiagnosisDetail> {
  return apiFetch<DiagnosisDetail>(`/diagnoses/${id}`);
}

/**
 * Simulate a failed build with a pre-defined scenario.
 * 
 * @param scenario - The simulation scenario to run (defaults to "test-failure" on backend if omitted)
 * @returns Response containing the new diagnosis ID, scenario, and pending status
 * 
 * Maps to: POST /simulate
 */
export async function postSimulate(
  scenario?: SimulationScenario
): Promise<{ id: string; scenario: SimulationScenario; status: 'pending' }> {
  return apiFetch<{ id: string; scenario: SimulationScenario; status: 'pending' }>(
    '/simulate',
    {
      method: 'POST',
      body: JSON.stringify(scenario ? { scenario } : {}),
    }
  );
}

/**
 * Submit helpfulness feedback for a diagnosis.
 * 
 * @param diagnosisId - The diagnosis record ID (UUID)
 * @param clientId - Anonymous client UUID from localStorage
 * @param rating - Either "helpful" or "unhelpful"
 * @returns Response containing the feedback record details
 * 
 * Maps to: POST /diagnoses/:id/feedback
 * Requirement: 13.2
 */
export async function postFeedback(
  diagnosisId: string,
  clientId: string,
  rating: 'helpful' | 'unhelpful'
): Promise<{
  id: string;
  buildRecordId: string;
  clientId: string;
  rating: 'helpful' | 'unhelpful';
  createdAt: string;
}> {
  return apiFetch<{
    id: string;
    buildRecordId: string;
    clientId: string;
    rating: 'helpful' | 'unhelpful';
    createdAt: string;
  }>(`/diagnoses/${diagnosisId}/feedback`, {
    method: 'POST',
    headers: {
      'X-Client-Id': clientId,
    },
    body: JSON.stringify({ rating }),
  });
}
