exports.up = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS app_users_business_email;
    CREATE UNIQUE INDEX app_users_auth_email
      ON app_users (lower(email))
      WHERE email IS NOT NULL;
  `);
};

exports.down = false;
