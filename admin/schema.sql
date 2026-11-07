-- Separate database for the private Smart POS control plane. Apply with psql.
CREATE TABLE IF NOT EXISTS super_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
  password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  csrf text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text NOT NULL, business_name text NOT NULL,
  email text, phone text, whatsapp text, address text, country text, status text NOT NULL DEFAULT 'active',
  notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, duration_days integer,
  price numeric(12,2) NOT NULL DEFAULT 0, currency char(3) NOT NULL DEFAULT 'USD', device_limit integer NOT NULL DEFAULT 1,
  grace_days integer NOT NULL DEFAULT 7, active boolean NOT NULL DEFAULT true, features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  plan_id uuid NOT NULL REFERENCES plans(id), status text NOT NULL DEFAULT 'pending_payment',
  starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers(id),
  subscription_id uuid REFERENCES subscriptions(id), secret_hash text UNIQUE NOT NULL, key_hint text NOT NULL,
  status text NOT NULL DEFAULT 'available', device_limit integer NOT NULL DEFAULT 1, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), license_id uuid NOT NULL REFERENCES licenses(id),
  device_id text NOT NULL, device_name text NOT NULL DEFAULT '', os text NOT NULL DEFAULT '', app_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active', activated_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
  UNIQUE(license_id, device_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES customers(id),
  subscription_id uuid REFERENCES subscriptions(id), invoice_number text UNIQUE NOT NULL, amount numeric(12,2) NOT NULL,
  currency char(3) NOT NULL, method text NOT NULL, reference text, status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz, notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY, actor_id uuid REFERENCES super_admins(id), action text NOT NULL,
  entity text, entity_id text, ip inet, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_expiry_idx ON subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS licenses_customer_idx ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS activations_license_idx ON activations(license_id);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments(paid_at);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at DESC);
