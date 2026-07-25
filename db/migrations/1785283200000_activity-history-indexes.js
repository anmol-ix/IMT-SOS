exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX sales_activity_history
      ON sales (business_id, completed_at DESC)
      WHERE status = 'COMPLETED';

    CREATE INDEX price_approval_activity_history
      ON price_approval_requests (business_id, updated_at DESC);

    CREATE INDEX guest_approval_activity_history
      ON guest_sale_approval_requests (business_id, updated_at DESC);
  `);
};

exports.down = false;
