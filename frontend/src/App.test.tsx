/**
 * Unit tests for App component.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

describe('App Component', () => {
  it('renders without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });

  it('renders with BrowserRouter', () => {
    const { container } = render(<App />);
    // The App should render without errors when wrapped in BrowserRouter
    expect(container.querySelector('div')).toBeTruthy();
  });
});
