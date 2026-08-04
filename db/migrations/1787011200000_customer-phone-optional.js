exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE customers
      ALTER COLUMN phone_normalized DROP NOT NULL;
  `);
};

exports.down = false;
