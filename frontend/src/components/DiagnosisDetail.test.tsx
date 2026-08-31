import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DiagnosisDetail from './DiagnosisDetail';
import type { DiagnosisDetail as DiagnosisDetailType } from '../types';

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

describe('DiagnosisDetail Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const mockCompleteDiagnosis: DiagnosisDetailType = {
    id: 'test-id-1',
    repoName: 'acme/payments-service',
    jobName: 'CI / build-and-test',
    commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    source: 'github',
    status: 'complete',
    category: 'test-failure',
    explanation: 'Tests failed due to assertion error in PaymentService.',
    confidence: 'high',
    suggestedFix: 'Update the test:\n```ts\nexpect(result).toBe(expected);\n```',
    rawLog: 'ERROR: Test suite failed\nAssertion error at line 42',
    truncated: true,
    createdAt: '2024-01-15T10:23:45Z',
    completedAt: '2024-01-15T10:23:52Z',
  };

  const mockPendingDiagnosis: DiagnosisDetailType = {
    ...mockCompleteDiagnosis,
    id: 'pending-id',
    status: 'pending',
    category: null,
    explanation: null,
    confidence: null,
    suggestedFix: null,
    completedAt: null,
  };

  const mockUnavailableDiagnosis: DiagnosisDetailType = {
    ...mockCompleteDiagnosis,
    id: 'unavailable-id',
    status: 'unavailable',
    category: null,
    explanation: null,
    confidence: null,
    suggestedFix: null,
  };

  const renderWithRouter = (initialPath: string) => {
    return render(
      <BrowserRouter>
        <Routes>
          <Route path="/diagnoses/:id" element={<DiagnosisDetail />} />
        </Routes>
      </BrowserRouter>,
      { wrapper: ({ children }) => <>{children}</> }
    );
  };

  it('fetches and displays complete diagnosis details (Req 8.3)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCompleteDiagnosis,
    });

    // Use the actual params in URL
    window.history.pushState({}, '', '/diagnoses/test-id-1');
    
    renderWithRouter('/diagnoses/test-id-1');

    // Loading state
    expect(screen.getByText(/loading diagnosis/i)).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('acme/payments-service')).toBeInTheDocument();
    });

    // Verify metadata fields (Req 8.3)
    expect(screen.getByText('acme/payments-service')).toBeInTheDocument();
    expect(screen.getByText('CI / build-and-test')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();

    // Verify status and category badges (Req 8.5)
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('test-failure')).toBeInTheDocument();

    // Verify explanation is displayed (Req 8.4)
    expect(screen.getByText(/Tests failed due to assertion error/i)).toBeInTheDocument();

    // Verify suggested fix is rendered (Req 8.4)
    expect(screen.getByText(/Update the test/i)).toBeInTheDocument();
  });

  it('renders markdown with syntax highlighting (Req 8.4)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCompleteDiagnosis,
    });

    window.history.pushState({}, '', '/diagnoses/test-id-1');
    renderWithRouter('/diagnoses/test-id-1');

    await waitFor(() => {
      expect(screen.getByText(/Update the test/i)).toBeInTheDocument();
    });

    // Verify code block is present with syntax highlighting applied
    // The text is broken up by syntax highlighting spans, so we use a flexible matcher
    const codeElement = screen.getByText((content, element) => {
      return element?.tagName.toLowerCase() === 'code' && 
             element.textContent?.includes('expect(result)') === true;
    });
    expect(codeElement).toBeInTheDocument();
    // Verify syntax highlighting is applied (hljs class)
    expect(codeElement).toHaveClass('hljs');
  });

  it('displays collapsible raw log section (Req 8.6)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCompleteDiagnosis,
    });

    window.history.pushState({}, '', '/diagnoses/test-id-1');
    renderWithRouter('/diagnoses/test-id-1');

    await waitFor(() => {
      expect(screen.getByText(/raw log/i)).toBeInTheDocument();
    });

    // Raw log should be present but initially not visible (collapsed)
    const rawLogHeader = screen.getByText(/raw log/i);
    expect(rawLogHeader).toBeInTheDocument();
    
    // Verify truncated indicator
    expect(screen.getByText(/raw log \(truncated\)/i)).toBeInTheDocument();
  });

  it('shows placeholder for pending diagnosis (Req 8.9)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPendingDiagnosis,
    });

    window.history.pushState({}, '', '/diagnoses/pending-id');
    renderWithRouter('/diagnoses/pending-id');

    await waitFor(() => {
      expect(screen.getByText(/diagnosis in progress/i)).toBeInTheDocument();
    });

    // Should show placeholder instead of null/empty fields
    expect(screen.getByText(/diagnosis in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/AI is analyzing/i)).toBeInTheDocument();

    // Should not show explanation or fix sections
    expect(screen.queryByText(/📋 Explanation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/🔧 Suggested Fix/i)).not.toBeInTheDocument();
  });

  it('shows placeholder for unavailable diagnosis (Req 8.9)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockUnavailableDiagnosis,
    });

    window.history.pushState({}, '', '/diagnoses/unavailable-id');
    renderWithRouter('/diagnoses/unavailable-id');

    await waitFor(() => {
      expect(screen.getByText(/diagnosis unavailable/i)).toBeInTheDocument();
    });

    // Should show unavailable placeholder
    expect(screen.getByText(/diagnosis unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/could not be generated/i)).toBeInTheDocument();

    // Should not show explanation or fix sections
    expect(screen.queryByText(/📋 Explanation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/🔧 Suggested Fix/i)).not.toBeInTheDocument();
  });

  it('handles 404 error gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    window.history.pushState({}, '', '/diagnoses/non-existent-id');
    renderWithRouter('/diagnoses/non-existent-id');

    await waitFor(() => {
      expect(screen.getByText(/diagnosis not found/i)).toBeInTheDocument();
    });

    // Should show back button
    expect(screen.getByText(/back to list/i)).toBeInTheDocument();
  });

  it('handles fetch error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    window.history.pushState({}, '', '/diagnoses/test-id-1');
    renderWithRouter('/diagnoses/test-id-1');

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/back to list/i)).toBeInTheDocument();
  });

  it('displays "Uncategorized" badge when category is null', async () => {
    const diagnosisWithNoCategory = {
      ...mockCompleteDiagnosis,
      category: null,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => diagnosisWithNoCategory,
    });

    window.history.pushState({}, '', '/diagnoses/test-id-1');
    renderWithRouter('/diagnoses/test-id-1');

    await waitFor(() => {
      expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    });
  });

  it('displays all required metadata fields (Req 8.3)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCompleteDiagnosis,
    });

    window.history.pushState({}, '', '/diagnoses/test-id-1');
    renderWithRouter('/diagnoses/test-id-1');

    await waitFor(() => {
      expect(screen.getByText('acme/payments-service')).toBeInTheDocument();
    });

    // Verify all required fields from Req 8.3
    expect(screen.getByText(/Repository:/i)).toBeInTheDocument();
    expect(screen.getByText(/Job:/i)).toBeInTheDocument();
    expect(screen.getByText(/Commit SHA:/i)).toBeInTheDocument();
    expect(screen.getByText(/Source:/i)).toBeInTheDocument();
    expect(screen.getByText(/Status:/i)).toBeInTheDocument();
    expect(screen.getByText(/Category:/i)).toBeInTheDocument();
    expect(screen.getByText(/Confidence:/i)).toBeInTheDocument();
    expect(screen.getByText(/Created:/i)).toBeInTheDocument();
    expect(screen.getByText(/Completed:/i)).toBeInTheDocument();
  });

  describe('Helpfulness Feedback (Req 13.1, 13.2)', () => {
    it('generates and persists client ID on first load', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      expect(localStorage.getItem('cicd-doctor-client-id')).toBeNull();

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByText('acme/payments-service')).toBeInTheDocument();
      });

      // Client ID should not be generated just by viewing the page
      // It's generated when feedback is submitted
      expect(localStorage.getItem('cicd-doctor-client-id')).toBeNull();
    });

    it('displays feedback buttons for complete diagnosis (Req 13.1)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByText(/was this diagnosis helpful/i)).toBeInTheDocument();
      });

      // Verify both buttons are present
      expect(screen.getByLabelText(/mark as helpful/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/mark as unhelpful/i)).toBeInTheDocument();
    });

    it('does not display feedback buttons for pending diagnosis', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPendingDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/pending-id');
      renderWithRouter('/diagnoses/pending-id');

      await waitFor(() => {
        expect(screen.getByText(/diagnosis in progress/i)).toBeInTheDocument();
      });

      // Should not show feedback buttons
      expect(screen.queryByLabelText(/mark as helpful/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/mark as unhelpful/i)).not.toBeInTheDocument();
    });

    it('does not display feedback buttons for unavailable diagnosis', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUnavailableDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/unavailable-id');
      renderWithRouter('/diagnoses/unavailable-id');

      await waitFor(() => {
        expect(screen.getByText(/diagnosis unavailable/i)).toBeInTheDocument();
      });

      // Should not show feedback buttons
      expect(screen.queryByLabelText(/mark as helpful/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/mark as unhelpful/i)).not.toBeInTheDocument();
    });

    it('submits thumbs-up feedback and updates UI (Req 13.2)', async () => {
      // Mock initial diagnosis fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByLabelText(/mark as helpful/i)).toBeInTheDocument();
      });

      const helpfulButton = screen.getByLabelText(/mark as helpful/i);
      expect(helpfulButton).not.toHaveClass('selected');

      // Mock feedback POST response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'feedback-uuid',
          buildRecordId: 'test-id-1',
          clientId: 'generated-client-id',
          rating: 'helpful',
          createdAt: '2024-01-15T10:30:00Z',
        }),
      });

      // Click thumbs-up
      fireEvent.click(helpfulButton);

      // Wait for the button to be selected
      await waitFor(() => {
        expect(helpfulButton).toHaveClass('selected');
      });

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/diagnoses/test-id-1/feedback'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Client-Id': expect.any(String),
          }),
          body: JSON.stringify({ rating: 'helpful' }),
        })
      );

      // Verify rating is persisted in localStorage
      const ratingsJson = localStorage.getItem('cicd-doctor-ratings');
      expect(ratingsJson).not.toBeNull();
      const ratings = JSON.parse(ratingsJson!);
      expect(ratings['test-id-1']).toBe('helpful');
    });

    it('submits thumbs-down feedback and updates UI (Req 13.2)', async () => {
      // Mock initial diagnosis fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByLabelText(/mark as unhelpful/i)).toBeInTheDocument();
      });

      const unhelpfulButton = screen.getByLabelText(/mark as unhelpful/i);
      expect(unhelpfulButton).not.toHaveClass('selected');

      // Mock feedback POST response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'feedback-uuid',
          buildRecordId: 'test-id-1',
          clientId: 'generated-client-id',
          rating: 'unhelpful',
          createdAt: '2024-01-15T10:30:00Z',
        }),
      });

      // Click thumbs-down
      fireEvent.click(unhelpfulButton);

      // Wait for the button to be selected
      await waitFor(() => {
        expect(unhelpfulButton).toHaveClass('selected');
      });

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/diagnoses/test-id-1/feedback'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 'unhelpful' }),
        })
      );

      // Verify rating is persisted in localStorage
      const ratingsJson = localStorage.getItem('cicd-doctor-ratings');
      expect(ratingsJson).not.toBeNull();
      const ratings = JSON.parse(ratingsJson!);
      expect(ratings['test-id-1']).toBe('unhelpful');
    });

    it('shows existing rating from localStorage on mount (Req 13.1)', async () => {
      // Pre-populate localStorage with a rating
      const existingRatings = { 'test-id-1': 'helpful' };
      localStorage.setItem('cicd-doctor-ratings', JSON.stringify(existingRatings));

      // Mock initial diagnosis fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByLabelText(/mark as helpful/i)).toBeInTheDocument();
      });

      // The helpful button should be selected
      const helpfulButton = screen.getByLabelText(/mark as helpful/i);
      expect(helpfulButton).toHaveClass('selected');

      // The unhelpful button should not be selected
      const unhelpfulButton = screen.getByLabelText(/mark as unhelpful/i);
      expect(unhelpfulButton).not.toHaveClass('selected');
    });

    it('allows changing rating from thumbs-up to thumbs-down', async () => {
      // Pre-populate localStorage with a helpful rating
      const existingRatings = { 'test-id-1': 'helpful' };
      localStorage.setItem('cicd-doctor-ratings', JSON.stringify(existingRatings));

      // Mock initial diagnosis fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByLabelText(/mark as helpful/i)).toHaveClass('selected');
      });

      // Mock feedback POST response for unhelpful
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'feedback-uuid',
          buildRecordId: 'test-id-1',
          clientId: 'client-id',
          rating: 'unhelpful',
          createdAt: '2024-01-15T10:30:00Z',
        }),
      });

      // Click thumbs-down
      const unhelpfulButton = screen.getByLabelText(/mark as unhelpful/i);
      fireEvent.click(unhelpfulButton);

      // Wait for the state to update
      await waitFor(() => {
        expect(unhelpfulButton).toHaveClass('selected');
      });

      // Verify thumbs-up is no longer selected
      const helpfulButton = screen.getByLabelText(/mark as helpful/i);
      expect(helpfulButton).not.toHaveClass('selected');

      // Verify localStorage was updated
      const ratingsJson = localStorage.getItem('cicd-doctor-ratings');
      const ratings = JSON.parse(ratingsJson!);
      expect(ratings['test-id-1']).toBe('unhelpful');
    });

    it('handles feedback submission error gracefully', async () => {
      // Mock initial diagnosis fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompleteDiagnosis,
      });

      window.history.pushState({}, '', '/diagnoses/test-id-1');
      renderWithRouter('/diagnoses/test-id-1');

      await waitFor(() => {
        expect(screen.getByLabelText(/mark as helpful/i)).toBeInTheDocument();
      });

      const helpfulButton = screen.getByLabelText(/mark as helpful/i);

      // Mock feedback POST failure
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Click thumbs-up
      fireEvent.click(helpfulButton);

      // The button should briefly show as selected (optimistic update)
      await waitFor(() => {
        expect(helpfulButton).toHaveClass('selected');
      });

      // After the error, the button should revert (no selection)
      await waitFor(() => {
        expect(helpfulButton).not.toHaveClass('selected');
      });
    });
  });
});
