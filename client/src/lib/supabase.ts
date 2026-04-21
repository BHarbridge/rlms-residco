import { createClient } from "@supabase/supabase-js";

// Public Supabase credentials — anon key is safe to expose in frontend
const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://qgdrgiqrkoyhvbakuqwo.supabase.co";
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZHJnaXFya295aHZiYWt1cXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2Mzc1NzksImV4cCI6MjA5MjIxMzU3OX0.QfgyMj3NpPw6kwQhKBT5rC2fIDgucsh5gitMRsRI8aQ";

// In-memory storage adapter — avoids localStorage/sessionStorage which are
// blocked in sandboxed iframes. Sessions persist for the tab lifetime.
const memoryStore: Record<string, string> = {};
const memoryStorage = {
  getItem: (key: string) => memoryStore[key] ?? null,
  setItem: (key: string, value: string) => { memoryStore[key] = value; },
  removeItem: (key: string) => { delete memoryStore[key]; },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: memoryStorage,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
