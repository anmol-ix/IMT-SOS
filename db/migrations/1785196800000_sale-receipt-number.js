exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales ADD COLUMN sale_number text;

    UPDATE sales
       SET sale_number = 'SAL-' || upper(substr(replace(id::text, '-', ''), 1, 12));

    ALTER TABLE sales
      ALTER COLUMN sale_number SET NOT NULL,
      ADD CONSTRAINT sale_number_format
        CHECK (sale_number ~ '^SAL-[0-9A-F]{12}$'),
      ADD CONSTRAINT unique_sale_number UNIQUE (sale_number);
  `);
};

exports.down = false;
