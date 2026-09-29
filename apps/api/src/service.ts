export interface EuthynaApiService {
  createBusiness(input: unknown): Promise<unknown>;
  createVendor(input: unknown): Promise<unknown>;
  proposeDestination(vendorId: string, input: unknown): Promise<unknown>;
  verifyDestination(vendorId: string, version: number, input: unknown): Promise<unknown>;
  ingestEvidence(input: unknown): Promise<unknown>;
  createObligation(input: unknown): Promise<unknown>;
  verifyObligation(obligationId: string): Promise<unknown>;
  listObligations(query: unknown): Promise<unknown>;
  runPlan(input: unknown): Promise<unknown>;
  attestIntent(intentId: string, input: unknown): Promise<unknown>;
  simulateIntent(intentId: string): Promise<unknown>;
  submitIntent(intentId: string, input: unknown): Promise<unknown>;
  reconcile(input: unknown): Promise<unknown>;
  getReceipt(receiptId: string): Promise<unknown>;
  getMetrics(query: unknown): Promise<unknown>;
  recordFeedback(decisionId: string, input: unknown): Promise<unknown>;
}

