import "server-only";

import { randomUUID } from "node:crypto";
import type { CurrentUser } from "./auth/current-user";
import { requireRole } from "./auth/roles";
import { getDatabase, inTransaction } from "./database";

export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
};

type SupplierRow = {
  id: string;
  name: string;
  phone_normalized: string | null;
  notes: string | null;
};

export function normalizeSupplierName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone_normalized,
    notes: row.notes,
  };
}

export class SupplierAlreadyExistsError extends Error {
  readonly status = 409;
  readonly code = "SUPPLIER_ALREADY_EXISTS";

  constructor() {
    super("This supplier already exists. Select it from the supplier list.");
    this.name = "SupplierAlreadyExistsError";
  }
}

export async function listSuppliers(user: CurrentUser): Promise<Supplier[]> {
  requireRole(user.role, ["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
  const result = await getDatabase().query<SupplierRow>(
    `SELECT id, name, phone_normalized, notes
       FROM suppliers
      WHERE business_id = $1 AND status = 'ACTIVE'
      ORDER BY name
      LIMIT 250`,
    [user.businessId],
  );
  return result.rows.map(mapSupplier);
}

export async function createSupplier(
  user: CurrentUser,
  input: { name: string; phone?: string; notes?: string },
): Promise<Supplier> {
  requireRole(user.role, ["BUSINESS_OWNER", "TRUSTED_OPERATOR"]);
  return inTransaction(async (client) => {
    const id = randomUUID();
    const inserted = await client.query<SupplierRow>(
      `INSERT INTO suppliers
         (id, business_id, name, normalized_name, phone_normalized, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (business_id, normalized_name) DO NOTHING
       RETURNING id, name, phone_normalized, notes`,
      [
        id,
        user.businessId,
        input.name.trim().replace(/\s+/g, " "),
        normalizeSupplierName(input.name),
        input.phone || null,
        input.notes?.trim() || null,
        user.id,
      ],
    );
    if (!inserted.rows[0]) throw new SupplierAlreadyExistsError();
    await client.query(
      `INSERT INTO audit_events
         (business_id, actor_user_id, event_type, entity_type, entity_id, details)
       VALUES ($1, $2, 'SUPPLIER_CREATED', 'SUPPLIER', $3, $4)`,
      [user.businessId, user.id, id, { name: input.name.trim() }],
    );
    return mapSupplier(inserted.rows[0]);
  });
}
