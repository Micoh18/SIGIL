import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PaymentIntentRecord, PaymentReceiptRecord, PaymentStore } from "./types.js";

type PaymentStoreFile = {
  schema_version: "sigil.payment-store.v1";
  intents: PaymentIntentRecord[];
  receipts: PaymentReceiptRecord[];
};

export class FilePaymentStore implements PaymentStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "payments.json");
  }

  async saveIntent(intent: PaymentIntentRecord): Promise<void> {
    const data = await this.load();
    const existingIndex = data.intents.findIndex((item) => item.id === intent.id);
    if (existingIndex >= 0) {
      data.intents[existingIndex] = intent;
    } else {
      data.intents.push(intent);
    }
    await this.persist(data);
  }

  async getIntent(paymentId: string): Promise<PaymentIntentRecord | null> {
    const data = await this.load();
    return data.intents.find((intent) => intent.id === paymentId) ?? null;
  }

  async findIntentByIdempotencyKey(
    agentId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentRecord | null> {
    const data = await this.load();
    return (
      data.intents.find(
        (intent) => intent.agent_id === agentId && intent.idempotency_key === idempotencyKey
      ) ?? null
    );
  }

  async saveReceipt(receipt: PaymentReceiptRecord): Promise<void> {
    const data = await this.load();
    const existingIndex = data.receipts.findIndex((item) => item.id === receipt.id);
    if (existingIndex >= 0) {
      data.receipts[existingIndex] = receipt;
    } else {
      data.receipts.push(receipt);
    }
    await this.persist(data);
  }

  async getReceipt(paymentId: string): Promise<PaymentReceiptRecord | null> {
    const data = await this.load();
    return data.receipts.find((receipt) => receipt.payment_id === paymentId) ?? null;
  }

  private async load(): Promise<PaymentStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PaymentStoreFile;

      return {
        schema_version: "sigil.payment-store.v1",
        intents: Array.isArray(parsed.intents) ? parsed.intents : [],
        receipts: Array.isArray(parsed.receipts) ? parsed.receipts : []
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyStore();
      }

      throw error;
    }
  }

  private async persist(data: PaymentStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

function emptyStore(): PaymentStoreFile {
  return {
    schema_version: "sigil.payment-store.v1",
    intents: [],
    receipts: []
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
