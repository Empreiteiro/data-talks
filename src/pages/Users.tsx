import { useState, useEffect } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";

interface UserWithRole {
  id: string;
  email: string;
  role: 'admin' | 'member';
  created_at: string;
}

const Users = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: currentUserRole } = useUserRole(user?.id);
  const queryClient = useQueryClient();
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<'admin' | 'member'>('member');

  const { data: usersWithRoles = [] } = useQuery({
    queryKey: ['users-with-roles'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const { data, error } = await supabase.functions.invoke('get-users-with-roles', {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      
      if (error) throw error;
      return data as UserWithRole[];
    },
    enabled: currentUserRole === 'admin',
  });

  const addUserMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: 'admin' | 'member' }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { email, role },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(data?.message || t('users.inviteSuccess'));
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
      setIsAddUserOpen(false);
      setNewUserEmail("");
      setNewUserRole('member');
    },
    onError: (error: any) => {
      const errorMessage = error.message.includes('already been registered') 
        ? t('users.emailAlreadyExists')
        : `${t('users.addError')} ${error.message}`;
      toast.error(errorMessage);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t('users.removeSuccess'));
      queryClient.invalidateQueries({ queryKey: ['users-with-roles'] });
    },
    onError: (error: any) => {
      toast.error(`${t('users.removeError')} ${error.message}`);
    },
  });

  // Redirect if not admin
  useEffect(() => {
    if (currentUserRole !== undefined && currentUserRole !== 'admin') {
      navigate('/dashboard');
    }
  }, [currentUserRole, navigate]);

  // Show loading while checking role
  if (currentUserRole === undefined) {
    return null;
  }

  if (currentUserRole !== 'admin') {
    return null;
  }

  const handleAddUser = () => {
    if (!newUserEmail) {
      toast.error(t('users.validEmailError'));
      return;
    }
    addUserMutation.mutate({ email: newUserEmail, role: newUserRole });
  };

  return (
    <main className="container py-10">
      <SEO 
        title={`${t('users.title')} | Orion.t2d`}
        description={t('users.description')}
        canonical="/users" 
      />
      
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-semibold">{t('users.title')}</h1>
        <Button onClick={() => setIsAddUserOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          {t('users.addUser')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.systemUsers')}</CardTitle>
          <CardDescription>
            {t('users.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.email')}</TableHead>
                <TableHead>{t('users.profile')}</TableHead>
                <TableHead>{t('users.createdAt')}</TableHead>
                <TableHead className="text-right">{t('users.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersWithRoles.map((userWithRole) => (
                <TableRow key={userWithRole.id}>
                  <TableCell className="font-medium">{userWithRole.email}</TableCell>
                  <TableCell>
                    <Badge variant={userWithRole.role === 'admin' ? 'default' : 'secondary'}>
                      {userWithRole.role === 'admin' ? t('users.admin') : t('users.member')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(userWithRole.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    {userWithRole.id !== user?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteUserMutation.mutate(userWithRole.id)}
                        disabled={deleteUserMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {usersWithRoles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {t('users.noUsersFound')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.inviteNewUser')}</DialogTitle>
            <DialogDescription>
              {t('users.inviteDescription')}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('users.email')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t('users.emailPlaceholder')}
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="role">{t('users.profile')}</Label>
              <Select value={newUserRole} onValueChange={(value) => setNewUserRole(value as 'admin' | 'member')}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t('users.member')}</SelectItem>
                  <SelectItem value="admin">{t('users.admin')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddUserOpen(false)}>
              {t('users.cancel')}
            </Button>
            <Button onClick={handleAddUser} disabled={addUserMutation.isPending}>
              {addUserMutation.isPending ? t('users.adding') : t('users.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Users;
