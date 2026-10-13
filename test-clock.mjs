// Fixed clock for browser checks: fixtures use absolute dates (8-19 Oct 2026) and the server rejects fixed starts in the past.
// Override with ALOVEN_NOW to reproduce another day.
export const TEST_NOW = process.env.ALOVEN_NOW || '2026-10-07T06:00:00Z';
