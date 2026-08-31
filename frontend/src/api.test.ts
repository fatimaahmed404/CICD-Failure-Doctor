/**
 * Unit tests for API client functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchDiagnoses, fetchDiagnosisById, postSimulate } from './api';
import type { DiagnosisListResponse, DiagnosisDetail } from './types';

describe('API Client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Mock fetch globally
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('fetchDiagnoses', () => {
    it('fetches diagnoses with default pagination', async () => {
      const mockResponse: DiagnosisListResponse = {
        data: [
          {
            id: '123',
            repoName: 'test/repo',
            jobName: 'CI / build',
            commitSha: 'abc123def456',
            source: 'github',
            status: 'complete',
            category: 'test-failure',
            explanation: 'Test failed',
            confidence: 'high',
            createdAt: '2024-01-15T15:00:00Z',
            completedAt: '2024-01-15T15:01:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchDiagnoses();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/diagnoses?page=1&limit=20'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('fetches diagnoses with custom pagination and category filter', async () => {
      const mockResponse: DiagnosisListResponse = {
        data: [],
        total: 0,
        page: 2,
        pageSize: 50,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await fetchDiagnoses(2, 50, 'test-failure');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/diagnoses?page=2&limit=50&category=test-failure'),
        expect.any(Object)
      );
    });

    it('throws error on failed request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error',
      });

      await expect(fetchDiagnoses()).rejects.toThrow(
        'API request failed: 500 Internal Server Error'
      );
    });
  });

  describe('fetchDiagnosisById', () => {
    it('fetches a single diagnosis by ID', async () => {
      const mockResponse: DiagnosisDetail = {
        id: '123',
        repoName: 'test/repo',
        jobName: 'CI / build',
        commitSha: 'abc123def456',
        source: 'github',
        status: 'complete',
        category: 'test-failure',
        explanation: 'Test failed',
        confidence: 'high',
        createdAt: '2024-01-15T15:00:00Z',
        completedAt: '2024-01-15T15:01:00Z',
        suggestedFix: '## Fix\nUpdate test',
        rawLog: 'Error: test failed\n',
        truncated: false,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchDiagnosisById('123');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/diagnoses/123'),
        expect.any(Object)
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws error when diagnosis not found', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Diagnosis not found',
      });

      await expect(fetchDiagnosisById('invalid-id')).rejects.toThrow(
        'API request failed: 404 Not Found'
      );
    });
  });

  describe('postSimulate', () => {
    it('posts simulate request with scenario', async () => {
      const mockResponse = {
        id: 'sim-123',
        scenario: 'test-failure' as const,
        status: 'pending' as const,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await postSimulate('test-failure');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/simulate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ scenario: 'test-failure' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('posts simulate request without scenario (uses backend default)', async () => {
      const mockResponse = {
        id: 'sim-456',
        scenario: 'test-failure' as const,
        status: 'pending' as const,
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await postSimulate();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/simulate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        })
      );
    });

    it('throws error on failed simulate request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid scenario',
      });

      await expect(postSimulate('invalid' as any)).rejects.toThrow(
        'API request failed: 400 Bad Request'
      );
    });
  });
});
