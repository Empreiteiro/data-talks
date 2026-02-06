/**
 * Open-source version: Supabase is not used. All data and auth go through the Python API.
 * This stub exists so any leftover imports fail explicitly instead of connecting to Supabase.
 */
const stub = new Proxy(
  {} as any,
  {
    get() {
      throw new Error(
        'Supabase is not used in this version. Use dataClient from @/services/supabaseClient and the Python API for auth.'
      );
    },
  }
);

export const supabase = stub;
