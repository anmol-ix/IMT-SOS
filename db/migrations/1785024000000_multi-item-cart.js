const runtimeRole = process.env.RUNTIME_DATABASE_ROLE ?? "itsmytoy_runtime";

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error("RUNTIME_DATABASE_ROLE must be a safe PostgreSQL identifier");
}

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sale_lines
      ADD COLUMN price_approval_id uuid REFERENCES price_approval_requests(id);

    UPDATE sale_lines sl
       SET price_approval_id = s.price_approval_id
      FROM sales s
     WHERE sl.sale_id = s.id AND s.price_approval_id IS NOT NULL;

    DROP INDEX one_sale_per_price_approval;
    ALTER TABLE sales DROP COLUMN price_approval_id;

    CREATE UNIQUE INDEX one_sale_line_per_price_approval
      ON sale_lines (price_approval_id) WHERE price_approval_id IS NOT NULL;
  `);
};

exports.down = false;
