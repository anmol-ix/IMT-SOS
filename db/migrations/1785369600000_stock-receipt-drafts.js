const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE stock_receipts
      DROP CONSTRAINT stock_receipts_status_check,
      ALTER COLUMN completed_at DROP NOT NULL,
      ALTER COLUMN result_json DROP NOT NULL,
      ADD COLUMN completed_by uuid REFERENCES app_users(id),
      ADD COLUMN completion_command_id uuid,
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
      ADD CONSTRAINT stock_receipts_status_check
        CHECK (status IN ('DRAFT', 'COMPLETED', 'VOIDED'));

    UPDATE stock_receipts
       SET completed_by = created_by,
           completion_command_id = command_id
     WHERE status = 'COMPLETED';

    ALTER TABLE stock_receipts
      ADD CONSTRAINT completed_receipt_has_completion
        CHECK (
          status <> 'COMPLETED' OR
          (completed_at IS NOT NULL AND completed_by IS NOT NULL
           AND completion_command_id IS NOT NULL AND result_json IS NOT NULL)
        ),
      ADD CONSTRAINT draft_receipt_has_no_completion
        CHECK (
          status <> 'DRAFT' OR
          (completed_at IS NULL AND completed_by IS NULL
           AND completion_command_id IS NULL AND result_json IS NULL)
        );

    CREATE UNIQUE INDEX one_receipt_per_completion_command
      ON stock_receipts (completion_command_id)
      WHERE completion_command_id IS NOT NULL;

    CREATE INDEX pending_stock_receipts
      ON stock_receipts (business_id, created_at)
      WHERE status = 'DRAFT';

    GRANT UPDATE (
      status, completed_by, completion_command_id, completed_at, result_json, updated_at
    ) ON stock_receipts TO ${role};
    GRANT UPDATE (previous_landed_cost_paise) ON stock_receipt_lines TO ${role};
  `);
};

exports.down = false;
