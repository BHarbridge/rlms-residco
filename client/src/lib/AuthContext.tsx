import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Role = "admin" | "viewer" | null;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: Role;
  loading: boolean;
  needsPasswordChange: boolean;
  clearNeedsPasswordChange: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  loading: true,
  needsPasswordChange: false,
  clearNeedsPasswordChange: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);

  // Fetch role from our Express backend (which checks user_roles table)
  async function fetchRole(token: string): Promise<Role> {
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.role ?? null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.access_token) {
        const r = await fetchRole(session.access_token);
        setRole(r);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        if (session?.access_token) {
          const r = await fetchRole(session.access_token);
          setRole(r);
        } else {
          setRole(null);
        }
        // PASSWORD_RECOVERY fires when user clicks a reset-password email link
        if (event === "PASSWORD_RECOVERY") {
          setNeedsPasswordChange(true);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        loading,
        needsPasswordChange,
        clearNeedsPasswordChange: () => setNeedsPasswordChange(false),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Returns true if the current user can make changes (admin only) */
export function useCanEdit() {
  const { role } = useAuth();
  return role === "admin";
}
