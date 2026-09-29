import { describe, expect, it, vi } from "vitest";
import { CircleTransactionSigner } from "./circle-executor.js";

describe("Circle transaction signer boundary", () => {
  it("sends only a serialized transaction request and returns signed bytes", async () => {
    const signTransaction = vi.fn().mockResolvedValue({
      data: { signedTransaction: "0x02abcd", txHash: `0x${"1".repeat(64)}` },
    });
    const signer = new CircleTransactionSigner({ signTransaction }, "wallet-id");
    await expect(
      signer.sign({ chainId: 5_042_002, nonce: "1", value: "0" }, "obligation"),
    ).resolves.toBe("0x02abcd");
    expect(signTransaction).toHaveBeenCalledWith({
      walletId: "wallet-id",
      transaction: JSON.stringify({ chainId: 5_042_002, nonce: "1", value: "0" }),
      memo: "obligation",
    });
  });

  it("fails closed when Circle omits signed transaction bytes", async () => {
    const signer = new CircleTransactionSigner(
      { signTransaction: vi.fn().mockResolvedValue({ data: {} }) },
      "wallet-id",
    );
    await expect(signer.sign({ chainId: 5_042_002 }, "obligation")).rejects.toThrow(
      /valid signed EVM transaction/,
    );
  });
});

