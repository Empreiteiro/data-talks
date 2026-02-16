import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("account.users.createError"));
    } finally {
      setCreating(false);
    }
  };

  // Single user mode (no login)
  if (!loginRequired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("account.users.title")}
          </CardTitle>
          <CardDescription>{t("account.users.singleUserMode")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Logged in but not admin
  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("account.users.title")}
          </CardTitle>
          <CardDescription>{t("account.users.adminOnly")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Admin: show list and create form
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("account.users.title")}
          </CardTitle>
          <CardDescription>{t("account.users.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Create user form */}
          <form onSubmit={handleCreate} className="space-y-4 p-4 rounded-lg border bg-muted/30">
            <h3 className="font-medium flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              {t("account.users.addUser")}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="flex items-end">
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : t("account.users.addUser")}
                </Button>
              </div>
            </div>
          </form>

          {/* Users table */}
          <div>
            <h3 className="font-medium mb-3">{t("account.users.title")}</h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("account.users.loading")}</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("account.users.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("account.users.email")}</TableHead>
                    <TableHead>{t("account.users.role")}</TableHead>
                    <TableHead className="text-muted-foreground">ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <span
                          className={
                            u.role === "admin"
                              ? "text-primary font-medium"
                              : "text-muted-foreground"
                          }
                        >
                          {u.role === "admin" ? t("account.users.roleAdmin") : t("account.users.roleUser")}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{u.id}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UsersManagement;
