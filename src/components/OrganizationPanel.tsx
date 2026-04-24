import { Loader2, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/services/apiClient";


interface Member {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  joined_at: string | null;
}


const ROLE_OPTIONS: Array<{ value: Member["role"]; label: string }> = [
  { value: "viewer", label: "Viewer (read only)" },
  { value: "member", label: "Member (create/edit)" },
  { value: "admin", label: "Admin (delete, manage members)" },
  { value: "owner", label: "Owner (full control)" },
];


/**
 * Organization settings panel rendered inside the Account page.
 *
 * Visibility: any member sees the org info; only admins/owners can manage
 * members. The backend enforces the same rules — this is UX polish so we
 * don't render disabled controls that will 403 anyway.
 */
export default function OrganizationPanel() {
  const { activeOrganizationId, organizations, activeRole } = useAuth();
  const { toast } = useToast();

  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Member["role"]>("member");

  const activeOrg = useMemo(
    () => organizations.find((o) => o.id === activeOrganizationId) ?? null,
    [organizations, activeOrganizationId],
  );

  const canManage = activeRole === "owner" || activeRole === "admin";
  const isOwner = activeRole === "owner";

  const reload = useCallback(async () => {
    if (!activeOrganizationId) return;
    setLoading(true);
    try {
      const data = await api<Member[]>(`/api/organizations/${activeOrganizationId}/members`);
      setMembers(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load members";
      toast({ title: "Error", description: msg, variant: "destructive" });
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeOrganizationId, toast]);

  useEffect(() => {
    if (canManage) {
      void reload();
    } else {
      setLoading(false);
    }
  }, [canManage, reload]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !activeOrganizationId) return;
    setAdding(true);
    try {
      await api(`/api/organizations/${activeOrganizationId}/members`, {
        method: "POST",
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      toast({ title: "Member added", description: newEmail });
      setNewEmail("");
      setNewRole("member");
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add member";
      toast({ title: "Failed to add member", description: msg, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleChangeRole = async (userId: string, role: Member["role"]) => {
    if (!activeOrganizationId) return;
    try {
      await api(`/api/organizations/${activeOrganizationId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to update role";
      toast({ title: "Failed to update role", description: msg, variant: "destructive" });
    }
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!activeOrganizationId) return;
    if (!window.confirm(`Remove ${email} from the organization?`)) return;
    try {
      await api(`/api/organizations/${activeOrganizationId}/members/${userId}`, {
        method: "DELETE",
      });
      toast({ title: "Member removed", description: email });
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to remove member";
      toast({ title: "Failed to remove member", description: msg, variant: "destructive" });
    }
  };

  if (!activeOrg) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          No active organization. Use the switcher in the top bar to pick one.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <div className="text-lg font-medium">{activeOrg.name}</div>
          <div className="text-muted-foreground">
            Slug: <code>{activeOrg.slug ?? "—"}</code>
          </div>
          <div className="text-muted-foreground">Your role: {activeRole ?? activeOrg.role}</div>
        </CardContent>
      </Card>

      {!canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="py-4 text-sm text-muted-foreground">
            You need the admin or owner role to view and manage members.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                Add member
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="org-new-email">User email</Label>
                  <Input
                    id="org-new-email"
                    type="email"
                    placeholder="user@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="w-full sm:w-56">
                  <Label htmlFor="org-new-role">Role</Label>
                  <Select
                    value={newRole}
                    onValueChange={(v) => setNewRole(v as Member["role"])}
                  >
                    <SelectTrigger id="org-new-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.filter((r) => r.value !== "owner" || isOwner).map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </form>
              <p className="mt-3 text-xs text-muted-foreground">
                The user must already have a Data Talks account. Self-serve invites are not yet
                supported.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Members ({members?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </div>
              ) : members && members.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2">Email</th>
                        <th className="py-2">Role</th>
                        <th className="py-2">Joined</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.user_id} className="border-t">
                          <td className="py-2">{m.email}</td>
                          <td className="py-2">
                            <Select
                              value={m.role}
                              onValueChange={(v) => handleChangeRole(m.user_id, v as Member["role"])}
                              disabled={!isOwner && m.role === "owner"}
                            >
                              <SelectTrigger className="h-8 w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ROLE_OPTIONS.filter((r) => r.value !== "owner" || isOwner).map((r) => (
                                  <SelectItem key={r.value} value={r.value}>
                                    {r.label.split(" (")[0]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {m.joined_at
                              ? new Date(m.joined_at).toLocaleDateString()
                              : "—"}
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemove(m.user_id, m.email)}
                              disabled={!isOwner && m.role === "owner"}
                              aria-label={`Remove ${m.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-4 text-sm text-muted-foreground">No members yet.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
