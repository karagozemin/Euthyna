import type { Address, Hex } from "viem";

export interface PreparedTransaction {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

export interface SimulationResult {
  success: boolean;
  provider: "RPC" | "AOMI";
  expectedBalanceDeltaMinor: string;
  revertReason: string | null;
}

export interface ExecutionSimulator {
  simulate(transaction: PreparedTransaction): Promise<SimulationResult>;
}

export interface CallClient {
  call(request: PreparedTransaction): Promise<unknown>;
}

/** RPC preflight fallback. It proves execution viability, never business truth. */
export class RpcExecutionSimulator implements ExecutionSimulator {
  constructor(
    private readonly client: CallClient,
    private readonly expectedBalanceDeltaMinor: string,
  ) {}

  async simulate(transaction: PreparedTransaction): Promise<SimulationResult> {
    try {
      await this.client.call(transaction);
      return {
        success: true,
        provider: "RPC",
        expectedBalanceDeltaMinor: this.expectedBalanceDeltaMinor,
        revertReason: null,
      };
    } catch (error) {
      return {
        success: false,
        provider: "RPC",
        expectedBalanceDeltaMinor: "0",
        revertReason: error instanceof Error ? error.message : "Unknown simulation failure",
      };
    }
  }
}

