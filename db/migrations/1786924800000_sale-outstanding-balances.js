exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales
      ADD COLUMN amount_paid_paise bigint,
      ADD COLUMN balance_due_paise bigint NOT NULL DEFAULT 0,
      ADD COLUMN due_reason text
        CHECK (
          due_reason IN (
            'CUSTOMER_WILL_PAY_LATER',
            'DIGITAL_PAYMENT_PENDING'
          )
        );

    UPDATE sales
       SET amount_paid_paise = total_paise;

    ALTER TABLE sales
      ALTER COLUMN amount_paid_paise SET NOT NULL,
      ALTER COLUMN amount_paid_paise SET DEFAULT 0,
      ADD CONSTRAINT sale_paid_amount_is_valid
        CHECK (amount_paid_paise >= 0),
      ADD CONSTRAINT sale_due_amount_is_valid
        CHECK (balance_due_paise >= 0),
      ADD CONSTRAINT sale_payment_balance_matches_total
        CHECK (amount_paid_paise + balance_due_paise = total_paise),
      ADD CONSTRAINT sale_due_reason_matches_balance
        CHECK (
          (balance_due_paise = 0 AND due_reason IS NULL)
          OR
          (balance_due_paise > 0 AND due_reason IS NOT NULL)
        );
  `);
};

exports.down = false;
