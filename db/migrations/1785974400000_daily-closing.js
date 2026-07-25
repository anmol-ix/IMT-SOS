const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

const role = `"${runtimeRole}"`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE daily_closings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      closing_number text NOT NULL UNIQUE CHECK (
        closing_number ~ '^CLS-[A-Z0-9]{12}$'
      ),
      business_id uuid NOT NULL REFERENCES businesses(id),
      location_id uuid NOT NULL REFERENCES locations(id),
      business_date date NOT NULL,
      revision integer NOT NULL CHECK (revision > 0),
      supersedes_closing_id uuid REFERENCES daily_closings(id),
      correction_reason text CHECK (
        correction_reason IS NULL OR correction_reason IN (
          'LATE_SALES', 'COUNT_CORRECTION', 'PAYMENT_CORRECTION', 'OTHER'
        )
      ),
      correction_note text CHECK (
        correction_note IS NULL OR length(trim(correction_note)) BETWEEN 3 AND 500
      ),
      command_id uuid NOT NULL,
      request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      sales_cutoff_at timestamptz NOT NULL,
      sale_count integer NOT NULL CHECK (sale_count >= 0),
      unit_count integer NOT NULL CHECK (unit_count >= 0),
      revenue_paise bigint NOT NULL CHECK (revenue_paise >= 0),
      cash_sales_paise bigint NOT NULL CHECK (cash_sales_paise >= 0),
      opening_cash_paise bigint NOT NULL CHECK (opening_cash_paise >= 0),
      cash_paid_in_paise bigint NOT NULL CHECK (cash_paid_in_paise >= 0),
      cash_paid_out_paise bigint NOT NULL CHECK (cash_paid_out_paise >= 0),
      expected_drawer_cash_paise bigint NOT NULL CHECK (
        expected_drawer_cash_paise >= 0
        AND expected_drawer_cash_paise =
          opening_cash_paise + cash_sales_paise
          + cash_paid_in_paise - cash_paid_out_paise
      ),
      counted_drawer_cash_paise bigint NOT NULL CHECK (
        counted_drawer_cash_paise >= 0
      ),
      cash_variance_paise bigint NOT NULL CHECK (
        cash_variance_paise =
          counted_drawer_cash_paise - expected_drawer_cash_paise
      ),
      has_variance boolean NOT NULL,
      cash_movement_note text CHECK (
        cash_movement_note IS NULL OR
        length(trim(cash_movement_note)) BETWEEN 3 AND 500
      ),
      variance_note text CHECK (
        variance_note IS NULL OR length(trim(variance_note)) BETWEEN 3 AND 500
      ),
      closing_note text CHECK (
        closing_note IS NULL OR length(trim(closing_note)) BETWEEN 3 AND 500
      ),
      created_by uuid NOT NULL REFERENCES app_users(id),
      created_at timestamptz NOT NULL,
      result_json jsonb NOT NULL,
      UNIQUE (business_id, command_id),
      UNIQUE (business_id, location_id, business_date, revision),
      CHECK (
        (revision = 1 AND supersedes_closing_id IS NULL
          AND correction_reason IS NULL AND correction_note IS NULL)
        OR
        (revision > 1 AND supersedes_closing_id IS NOT NULL
          AND correction_reason IS NOT NULL AND correction_note IS NOT NULL)
      ),
      CHECK (
        (cash_paid_in_paise = 0 AND cash_paid_out_paise = 0)
        OR cash_movement_note IS NOT NULL
      ),
      CHECK (cash_variance_paise = 0 OR has_variance),
      CHECK (NOT has_variance OR variance_note IS NOT NULL)
    );

    CREATE UNIQUE INDEX one_daily_closing_successor
      ON daily_closings (supersedes_closing_id)
      WHERE supersedes_closing_id IS NOT NULL;
    CREATE INDEX daily_closings_latest
      ON daily_closings
        (business_id, location_id, business_date DESC, revision DESC);

    CREATE TABLE daily_closing_payments (
      closing_id uuid NOT NULL REFERENCES daily_closings(id),
      payment_mode text NOT NULL CHECK (
        payment_mode IN ('UPI', 'CARD', 'BANK_TRANSFER')
      ),
      expected_amount_paise bigint NOT NULL CHECK (expected_amount_paise >= 0),
      verified_amount_paise bigint NOT NULL CHECK (verified_amount_paise >= 0),
      variance_paise bigint GENERATED ALWAYS AS (
        verified_amount_paise - expected_amount_paise
      ) STORED,
      PRIMARY KEY (closing_id, payment_mode)
    );

    GRANT SELECT, INSERT ON daily_closings, daily_closing_payments TO ${role};
  `);
};

exports.down = false;
