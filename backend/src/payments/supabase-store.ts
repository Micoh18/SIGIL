import { SupabaseRestClient } from "../storage/supabase-rest.js";
import type { PaymentIntentRecord, PaymentReceiptRecord, PaymentStore } from "./types.js";

export class SupabasePaymentStore implements PaymentStore {
  private readonly intentsTable: string;
  private readonly receiptsTable: string;

  constructor(private readonly client: SupabaseRestClient) {
    this.intentsTable = client.table("payment_intents");
    this.receiptsTable = client.table("payment_receipts");
  }

  async saveIntent(intent: PaymentIntentRecord): Promise<void> {
    await this.client.upsert(
      this.intentsTable,
      {
        id: intent.id,
        agent_id: intent.agent_id,
        idempotency_key: intent.idempotency_key,
        created_at: intent.created_at,
        updated_at: intent.updated_at,
        record: intent
      },
      "id"
    );
  }

  async getIntent(paymentId: string): Promise<PaymentIntentRecord | null> {
    const [record] = await this.client.selectRecords<PaymentIntentRecord>(this.intentsTable, {
      filters: { id: paymentId },
      limit: 1
    });

    return record ?? null;
  }

  async findIntentByIdempotencyKey(
    agentId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentRecord | null> {
    const [record] = await this.client.selectRecords<PaymentIntentRecord>(this.intentsTable, {
      filters: { agent_id: agentId, idempotency_key: idempotencyKey },
      order: { column: "created_at" },
      limit: 1
    });

    return record ?? null;
  }

  async saveReceipt(receipt: PaymentReceiptRecord): Promise<void> {
    await this.client.upsert(
      this.receiptsTable,
      {
        id: receipt.id,
        payment_id: receipt.payment_id,
        created_at: receipt.created_at,
        record: receipt
      },
      "id"
    );
  }

  async getReceipt(paymentId: string): Promise<PaymentReceiptRecord | null> {
    const [record] = await this.client.selectRecords<PaymentReceiptRecord>(this.receiptsTable, {
      filters: { payment_id: paymentId },
      order: { column: "created_at" },
      limit: 1
    });

    return record ?? null;
  }
}
