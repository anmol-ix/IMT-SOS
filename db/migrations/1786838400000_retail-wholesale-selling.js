exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE price_versions
      ADD COLUMN wholesale_price_paise bigint;

    UPDATE price_versions
       SET wholesale_price_paise = standard_price_paise;

    ALTER TABLE price_versions
      ALTER COLUMN wholesale_price_paise SET NOT NULL,
      ADD CONSTRAINT wholesale_price_is_safe
        CHECK (
          wholesale_price_paise >= store_operator_floor_paise
          AND wholesale_price_paise <= standard_price_paise
        );

    ALTER TABLE sales
      ADD COLUMN sale_type text NOT NULL DEFAULT 'RETAIL'
        CHECK (sale_type IN ('RETAIL', 'WHOLESALE'));

    ALTER TABLE sale_lines
      ADD COLUMN wholesale_price_paise bigint;

    UPDATE sale_lines
       SET wholesale_price_paise = COALESCE(standard_price_paise, unit_price_paise);

    ALTER TABLE sale_lines
      ALTER COLUMN wholesale_price_paise SET NOT NULL,
      ADD CONSTRAINT frozen_wholesale_price_is_valid
        CHECK (wholesale_price_paise >= 0);
  `);
};

exports.down = false;
