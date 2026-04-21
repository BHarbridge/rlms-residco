import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Trash2, ShieldCheck, Eye, MailIcon } from "lucide-react";

interface AppUser {
  id: string;
  email: string;
  role: "admin" | "viewer";
  created_at: string;
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-b border-border px-6 py-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">RLMS</div>
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function UserManagement() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "viewer">("viewer");
  const [inviting, setInviting] = useState(false);
  const [resending, setResending] = useState<string | null>(null); // email being resent

  const authHeaders = { Authorization: `Bearer ${session?.access_token}` };

  const { data: users = [], isLoading } = useQuery<AppUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role }, authHeaders),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Role updated" });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const removeUser = useMutation({
    mutationFn: async (userId: string) =>
      apiRequest("DELETE", `/api/admin/users/${userId}`, undefined, authHeaders),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User removed" });
    },
    onError: () => toast({ title: "Failed to remove user", variant: "destructive" }),
  });

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to invite");
      toast({
        title: data.resent ? "Invite resent" : "Invitation sent",
        description: data.resent
          ? `A fresh login link has been sent to ${inviteEmail}.`
          : `${inviteEmail} will receive a login email.`,
      });
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    } catch (err: any) {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  async function handleResend(email: string, role: "admin" | "viewer") {
    setResending(email);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Resend failed");
      toast({
        title: "Invite resent",
        description: `A fresh login link has been sent to ${email}.`,
      });
    } catch (err: any) {
      toast({ title: "Resend failed", description: err.message, variant: "destructive" });
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="User Management"
        subtitle="Invite team members and manage access roles"
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Invite form */}
        <div className="rounded-xl border border-border bg-card p-5 max-w-lg">
          <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Invite a team member
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            They’ll receive an email with a login link. If they were already invited, a fresh link will be resent automatically.
          </p>
          <form onSubmit={handleInvite} className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Email address</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@residco.com"
                  required
                  data-testid="input-invite-email"
                  className="bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as any)}>
                  <SelectTrigger className="w-32 bg-background" data-testid="select-invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" disabled={inviting} data-testid="button-send-invite">
              {inviting ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        </div>

        {/* User table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Team members
            </span>
            <span className="text-xs text-muted-foreground">{users.length} user{users.length !== 1 ? "s" : ""}</span>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No users yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Joined</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-user-${u.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <Select
                        value={u.role}
                        onValueChange={(v) => updateRole.mutate({ userId: u.id, role: v })}
                      >
                        <SelectTrigger className="w-28 h-7 text-xs bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">
                            <span className="flex items-center gap-1.5">
                              <Eye className="h-3 w-3" /> Viewer
                            </span>
                          </SelectItem>
                          <SelectItem value="admin">
                            <span className="flex items-center gap-1.5">
                              <ShieldCheck className="h-3 w-3" /> Admin
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => handleResend(u.email, u.role)}
                          disabled={resending === u.email}
                          className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                          data-testid={`button-resend-invite-${u.id}`}
                          title="Resend invite link"
                        >
                          {resending === u.email
                            ? <span className="text-[10px]">Sending…</span>
                            : <MailIcon className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => removeUser.mutate(u.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          data-testid={`button-remove-user-${u.id}`}
                          title="Remove user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Role legend */}
        <div className="rounded-lg border border-border bg-muted/20 p-4 max-w-lg space-y-2">
          <p className="text-xs font-medium text-foreground mb-2">Role permissions</p>
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5 border-primary/40 text-primary">Admin</Badge>
            <p className="text-xs text-muted-foreground">Full access — can add, edit, delete railcars, leases, riders, and manage users.</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">Viewer</Badge>
            <p className="text-xs text-muted-foreground">Read-only — can view all data and export CSVs, but cannot make changes.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
