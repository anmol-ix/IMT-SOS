exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION create_default_location_for_business()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      INSERT INTO locations (business_id, name, timezone, status)
      VALUES (NEW.id, 'Main Store', 'Asia/Kolkata', 'ACTIVE');
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER businesses_create_default_location
      AFTER INSERT ON businesses
      FOR EACH ROW
      EXECUTE FUNCTION create_default_location_for_business();

    INSERT INTO locations (business_id, name, timezone, status)
    SELECT id, 'Main Store', 'Asia/Kolkata', 'ACTIVE'
    FROM businesses business
    WHERE NOT EXISTS (
      SELECT 1
      FROM locations location
      WHERE location.business_id = business.id
    );
  `);
};

exports.down = false;
