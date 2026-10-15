import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_ANON_KEY in .env');
}

// Service-role client — bypasses RLS, ONLY used server-side for admin-style
// operations (creating users, reading/writing any table). Never used to
// verify a user's own password — see authClient below for why.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Anon-key client — used ONLY to verify email/password via
// signInWithPassword(). Calling signInWithPassword on the service-role
// client above would switch that client's session into the logged-in
// user's own JWT, causing every later query on it to run as
// "authenticated" instead of "service_role" and fail with permission
// errors. Keeping this on a separate client avoids that entirely.
export const authClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);