import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import DiagnosisList from './DiagnosisList';
import type { DiagnosisListResponse } from '../types';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('DiagnosisList Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  const mockDiagnosisListResponse: DiagnosisListResponse = {
    data: [
      {
        id: 'test-id-1',
        repoName: 'test/repo',
        jobName: 'CI / build',
        commitSha: 'abc123def456',
        source: 'github',
        status: 'complete',
        category: 'test-failure',
        explanation: 'Tests failed due to assertion error.',
        confidence: 'high',
        createdAt: '2024-01-15T10:00:00Z',
        completedAt: '2024-01-15T10:01:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };

  it('renders diagnoses list after fetching', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiagnosisListResponse,
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    // Should show loading initially
    expect(screen.getByText(/loading diagnoses/i)).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('test/repo')).toBeInTheDocument();
    });

    // Verify table content
    expect(screen.getByText('CI / build')).toBeInTheDocument();
    expect(screen.getByText('abc123d')).toBeInTheDocument(); // Truncated SHA
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('test-failure')).toBeInTheDocument();
  });

  it('shows empty state when no diagnoses exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0, page: 1, pageSize: 20 }),
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/no diagnoses yet/i)).toBeInTheDocument();
    });
  });

  it('handles fetch error gracefully without clearing list', async () => {
    // First successful fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiagnosisListResponse,
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('test/repo')).toBeInTheDocument();
    });

    // Second fetch fails (poll error)
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Wait for poll to trigger
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });

    // Original list should still be visible (Req 8.10)
    expect(screen.getByText('test/repo')).toBeInTheDocument();
  });

  it('renders simulate button with scenario dropdown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0, page: 1, pageSize: 20 }),
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/simulate failed build/i)).toBeInTheDocument();
    });

    // Check dropdown has scenarios
    const dropdown = screen.getByRole('combobox') as HTMLSelectElement;
    expect(dropdown).toBeInTheDocument();
    expect(dropdown.value).toBe('test-failure'); // Default scenario
  });

  it('submits simulate request when button is clicked', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0, page: 1, pageSize: 20 }),
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/simulate failed build/i)).toBeInTheDocument();
    });

    // Mock simulate response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'sim-id', scenario: 'test-failure', status: 'pending' }),
    });

    // Mock immediate re-fetch after simulate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'sim-id',
            repoName: 'demo/repo',
            jobName: 'CI / simulate',
            commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            source: 'simulate',
            status: 'pending',
            category: null,
            explanation: null,
            confidence: null,
            createdAt: new Date().toISOString(),
            completedAt: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    });

    // Click simulate button
    const button = screen.getByText(/simulate failed build/i);
    fireEvent.click(button);

    // Verify POST was made
    await waitFor(() => {
      const postCalls = mockFetch.mock.calls.filter(
        (call) => call[1]?.method === 'POST'
      );
      expect(postCalls.length).toBeGreaterThan(0);
    });
  });

  it('navigates to detail view when row is clicked', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiagnosisListResponse,
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('test/repo')).toBeInTheDocument();
    });

    // Click on the row
    const row = screen.getByText('test/repo').closest('tr');
    expect(row).toBeInTheDocument();
    fireEvent.click(row!);

    // Verify navigation was called
    expect(mockNavigate).toHaveBeenCalledWith('/diagnoses/test-id-1');
  });

  it('displays correct status badges', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            ...mockDiagnosisListResponse.data[0],
            id: '1',
            status: 'pending',
          },
          {
            ...mockDiagnosisListResponse.data[0],
            id: '2',
            status: 'complete',
          },
          {
            ...mockDiagnosisListResponse.data[0],
            id: '3',
            status: 'unavailable',
          },
        ],
        total: 3,
        page: 1,
        pageSize: 20,
      }),
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      const statuses = screen.getAllByText(/pending|complete|unavailable/);
      expect(statuses.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('displays "Uncategorized" when category is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            ...mockDiagnosisListResponse.data[0],
            category: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    });

    render(
      <BrowserRouter>
        <DiagnosisList />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    });
  });
});
