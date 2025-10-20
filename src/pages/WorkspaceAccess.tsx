import { useState, useEffect } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useNavigate } from "react-router-dom";

interface WorkspaceAccess {
  id: string;
  workspace_id: string;
  workspace_name: string;
  user_id: string;
  user_email: string;
  granted_at: string;
}

const WorkspaceAccess = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: currentUserRole } = useUserRole(user?.id);
  const queryClient = useQueryClient();
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<string>("");

  const { data: workspaces = [] } = useQuery({
    queryKey: ['workspaces-for-sharing'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, name');
      
      if (error) throw error;
      return data;
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-for-sharing'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const { data, error } = await supabase.functions.invoke('get-users-for-sharing', {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      
      if (error) throw error;
      return data;
    },
  });

  const { data: accessList = [] } = useQuery({
    queryKey: ['workspace-access'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const { data, error } = await supabase.functions.invoke('get-workspace-access', {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });
      
      if (error) throw error;
      return data as WorkspaceAccess[];
    },
  });

  const grantAccessMutation = useMutation({
    mutationFn: async ({ workspaceId, userId }: { workspaceId: string; userId: string }) => {
      const { error } = await supabase
        .from('workspace_users')
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          granted_by: user?.id
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Acesso concedido com sucesso');
      queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
      setSelectedWorkspace("");
      setSelectedUser("");
    },
    onError: (error: any) => {
      toast.error(`Erro ao conceder acesso: ${error.message}`);
    },
  });

  const revokeAccessMutation = useMutation({
    mutationFn: async (accessId: string) => {
      const { error } = await supabase
        .from('workspace_users')
        .delete()
        .eq('id', accessId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Acesso revogado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['workspace-access'] });
    },
    onError: (error: any) => {
      toast.error(`Erro ao revogar acesso: ${error.message}`);
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

  const handleGrantAccess = () => {
    if (!selectedWorkspace || !selectedUser) {
      toast.error('Selecione um workspace e um usuário');
      return;
    }
    grantAccessMutation.mutate({ 
      workspaceId: selectedWorkspace, 
      userId: selectedUser 
    });
  };

  return (
    <main className="container py-10">
      <SEO 
        title="Controle de Acesso | Orion.t2d" 
        description="Gerencie o acesso dos usuários aos workspaces" 
        canonical="/workspace-access" 
      />
      
      <h1 className="text-3xl font-semibold mb-6">Controle de Acesso aos Workspaces</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Conceder Acesso</CardTitle>
          <CardDescription>
            Permita que usuários acessem workspaces específicos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex-1">
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um usuário" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              onClick={handleGrantAccess}
              disabled={grantAccessMutation.isPending || !selectedWorkspace || !selectedUser}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Conceder
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acessos Concedidos</CardTitle>
          <CardDescription>
            Lista de usuários com acesso a cada workspace
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Data de Concessão</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accessList.map((access) => (
                <TableRow key={access.id}>
                  <TableCell className="font-medium">{access.workspace_name}</TableCell>
                  <TableCell>{access.user_email}</TableCell>
                  <TableCell>
                    {new Date(access.granted_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => revokeAccessMutation.mutate(access.id)}
                      disabled={revokeAccessMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {accessList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Nenhum acesso concedido
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
};

export default WorkspaceAccess;
