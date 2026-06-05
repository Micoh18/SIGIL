export type SupabaseRestConfig = {
  url: string;
  key: string;
  schema: string;
  tablePrefix: string;
};

type SupabaseSelectOptions = {
  filters?: Record<string, string | null>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
};

type SupabaseRecord = Record<string, unknown>;

export class SupabaseRestClient {
  private readonly baseUrl: string;

  constructor(private readonly config: SupabaseRestConfig) {
    this.baseUrl = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  }

  table(name: string): string {
    return `${this.config.tablePrefix}${name}`;
  }

  async upsert(table: string, row: SupabaseRecord, onConflict: string): Promise<void> {
    const url = new URL(`${this.baseUrl}/${table}`);
    url.searchParams.set("on_conflict", onConflict);

    await this.request(url, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(row)
    });
  }

  async insert(table: string, row: SupabaseRecord): Promise<void> {
    await this.request(new URL(`${this.baseUrl}/${table}`), {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });
  }

  async selectRecords<T>(
    table: string,
    options: SupabaseSelectOptions = {}
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}/${table}`);
    url.searchParams.set("select", "record");

    for (const [column, value] of Object.entries(options.filters ?? {})) {
      url.searchParams.set(column, value === null ? "is.null" : `eq.${value}`);
    }

    if (options.order) {
      const direction = options.order.ascending === true ? "asc" : "desc";
      url.searchParams.set("order", `${options.order.column}.${direction}`);
    }

    if (options.limit !== undefined) {
      url.searchParams.set("limit", String(options.limit));
    }

    const rows = await this.request(url, { method: "GET" });
    if (!Array.isArray(rows)) {
      throw new Error(`Supabase table ${table} returned a non-array response`);
    }

    return rows.map((row) => {
      const record = asRecord(row).record;
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error(`Supabase table ${table} returned a row without a JSON record`);
      }

      return record as T;
    });
  }

  private async request(url: URL, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: {
        apikey: this.config.key,
        Authorization: `Bearer ${this.config.key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Profile": this.config.schema,
        "Content-Profile": this.config.schema,
        ...init.headers
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Supabase request failed: ${response.status} ${response.statusText}${body ? ` ${body}` : ""}`
      );
    }

    if (response.status === 204) {
      return null;
    }

    const body = await response.text();
    return body ? (JSON.parse(body) as unknown) : null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected Supabase row object");
  }

  return value as Record<string, unknown>;
}
