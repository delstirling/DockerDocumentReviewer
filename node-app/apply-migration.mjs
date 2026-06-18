import pg from "pg";
const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new Client({ connectionString });

async function applyMigration() {
  try {
    await client.connect();
    console.log("Connected to database");
    
    await client.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organization_id integer`);
    console.log("✓ Added organization_id column");
    
    const constraintCheck = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'users' AND constraint_name = 'users_organization_id_organizations_id_fk'
    `);
    
    if (constraintCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE public.users ADD CONSTRAINT users_organization_id_organizations_id_fk
        FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
        ON DELETE SET NULL ON UPDATE NO ACTION
      `);
      console.log("✓ Added foreign key constraint");
    } else {
      console.log("✓ Constraint already exists");
    }
    
    const verify = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'organization_id'
    `);
    
    console.log("✓ Migration complete. Column exists:", verify.rows.length > 0);
    
  } catch (error) {
    console.error("✗ Error:", error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
