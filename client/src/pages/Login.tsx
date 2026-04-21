import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import residcoGlobePath from "@assets/residco-globe.svg";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <img
            src={residcoGlobePath}
            alt="RESIDCO globe emblem"
            className="w-14 h-14 object-contain"
          />
          <div className="text-center">
            <div className="text-lg font-semibold tracking-wide text-foreground">RLMS</div>
            <div className="text-xs text-muted-foreground tracking-widest uppercase">RESIDCO</div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-lg">
          <h1 className="text-base font-semibold text-foreground mb-1">Sign in</h1>
          <p className="text-xs text-muted-foreground mb-5">
            Railcar Lease Management System
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@residco.com"
                required
                autoComplete="email"
                data-testid="input-email"
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                data-testid="input-password"
                className="bg-background"
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              data-testid="button-sign-in"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Contact your administrator to request access.
        </p>
      </div>
    </div>
  );
}
