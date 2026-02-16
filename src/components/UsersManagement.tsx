import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Users, UserPlus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { getApiUrl, getToken } from "@/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UserRow {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

const UsersManagement = () => {
  const { t } = useLanguage();
  const { isAdmin, loginRequired } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("user");

  const fetchUsers = useCallback(async () => {
    if (!isAdmin || !loginRequired) return;
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${getApiUrl()}/api/users`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUsers(data);
    } catch {
      toast.error(t("account.users.loadError"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, loginRequired, t]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setCreating(true);
    try {
      const token = getToken();
      const res = await fetch(`${getApiUrl()}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to create user");
      }
      toast.success(t("account.users.createSuccess"));
      setEmail("");
      setPassword("");
      setRole("user");
      setAddDialogOpen(false);
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("account.users.createError"));
    } finally {
      setCreating(false);
    }
  };

  // Single user mode (no login) – same panel layout, message only
  if (!loginRequired) {
    return (
      <div className="h-full flex flex-col bg-background border rounded-lg">
        <div className="p-4 border-b flex items-center h-[57px]">
          <h2 className="font-semibold">{t("account.users.title")}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Users className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("account.users.singleUserMode")}</p>
          </div>
        </div>
      </div>
    );
  }

  // Logged in but not admin – same panel layout
  if (!isAdmin) {
    return (
      <div className="h-full flex flex-col bg-background border rounded-lg">
        <div className="p-4 border-b flex items-center h-[57px]">
          <h2 className="font-semibold">{t("account.users.title")}</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Users className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("account.users.adminOnly")}</p>
          </div>
        </div>
      </div>
    );
  }

  // Admin: same layout as Data Sources – header + list (cards)
  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t("account.users.title")}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            {t("account.users.addUser")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("account.users.loading")}</p>
            </div>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Users className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{t("account.users.empty")}</p>
            <p className="text-xs text-muted-foreground mt-2">{t("account.users.description")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="group relative p-3 rounded-lg border transition-all bg-muted/30 border-muted hover:bg-muted/50"
              >
                <div className="flex items-start gap-2">
                  <Users className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className={`text-xs ${u.role === "admin" ? "text-primary border-primary/50" : ""}`}
                      >
                        {u.role === "admin" ? t("account.users.roleAdmin") : t("account.users.roleUser")}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]" title={u.id}>
                        {u.id}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              {t("account.users.addUser")}
            </DialogTitle>
            <DialogDescription>{t("account.users.description")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="user-email">{t("account.users.email")}</Label>
              <Input
                id="user-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-password">{t("account.users.password")}</Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">{t("account.users.role")}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t("account.users.roleUser")}</SelectItem>
                  <SelectItem value="admin">{t("account.users.roleAdmin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)} disabled={creating}>
                {t("users.cancel")}
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "..." : t("account.users.addUser")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UsersManagement;
