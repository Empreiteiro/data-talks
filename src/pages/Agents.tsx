import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Edit2, Trash2, Share, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { supabaseClient } from "@/services/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { PlanLimitAlert } from "@/components/PlanLimitAlert";

interface Agent {
  id: string;
  name: string;
  description?: string;
  source_ids: string[];
  suggested_questions?: string[];
  created_at: string;
  updated_at: string;
  has_share_token: boolean;
  has_password: boolean;
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { limits, usage, planName, canCreateAgent, isLoading: limitsLoading } = usePlanLimits();

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    setLoading(true);
    try {
      const data = await supabaseClient.listAgents();
      setAgents(data || []);
    } catch (error: any) {
      toast.error("Erro ao carregar agentes", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(agentId: string) {
    setDeleting(agentId);
    try {
      await supabaseClient.deleteAgent(agentId);
      toast.success("Agente removido", {
        description: "Agente removido com sucesso.",
      });
      await loadAgents();
    } catch (error: any) {
      toast.error("Erro ao remover agente", {
        description: error.message,
      });
    } finally {
      setDeleting(null);
    }
  }

  async function handleShare(agent: Agent) {
    if (agent.has_share_token) {
      try {
        const shareToken = await supabaseClient.getAgentShareToken(agent.id);
        const shareUrl = `${window.location.origin}/share/${shareToken}`;
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copiado", {
          description: "Link de compartilhamento copiado para a área de transferência.",
        });
      } catch (error: any) {
        toast.error("Erro ao obter link", {
          description: error.message,
        });
      }
    } else {
      // Navigate to edit page to enable sharing
      navigate(`/agents/${agent.id}`);
      toast.info("Configure o compartilhamento", {
        description: "Configure o compartilhamento na página de edição do agente.",
      });
    }
  }

  if (loading || limitsLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Carregando agentes...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agentes de IA</h1>
          <p className="text-muted-foreground">
            Gerencie seus agentes de IA ({usage.agents}/{limits.agents} - Plano {planName})
          </p>
        </div>
        <Button 
          onClick={() => navigate('/agents/new')}
          disabled={!canCreateAgent}
        >
          <Plus className="mr-2 h-4 w-4" />
          Novo Agente
        </Button>
      </div>

      {!canCreateAgent && (
        <div className="flex items-center justify-center mb-6">
          <PlanLimitAlert
            type="agents"
            limit={limits.agents}
            planName={planName}
            className="w-full"
          />
        </div>
      )}

      <div className="grid gap-6">
        {agents.map((agent) => (
          <Card key={agent.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {agent.name}
                    {agent.has_share_token && (
                      <Badge variant="outline" className="text-xs">
                        <Share className="h-3 w-3 mr-1" />
                        Compartilhado
                      </Badge>
                    )}
                    {agent.has_password && (
                      <Badge variant="secondary" className="text-xs">
                        Protegido
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Criado em {new Date(agent.created_at).toLocaleDateString('pt-BR')}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleShare(agent)}
                  >
                    <Share className="h-4 w-4 mr-2" />
                    {agent.has_share_token ? 'Copiar Link' : 'Compartilhar'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/agents/${agent.id}`)}
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    Editar
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deleting === agent.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover Agente</AlertDialogTitle>
                        <AlertDialogDescription>
                          Tem certeza que deseja remover o agente "{agent.name}"? 
                          Esta ação não pode ser desfeita e removerá todas as perguntas e configurações relacionadas.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(agent.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleting === agent.id ? 'Removendo...' : 'Remover'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {agent.description && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Descrição:</h4>
                    <p className="text-sm text-muted-foreground">{agent.description}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium mb-2">Informações:</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Fontes:</span>
                      <span className="ml-2 font-medium">{agent.source_ids?.length || 0}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Perguntas sugeridas:</span>
                      <span className="ml-2 font-medium">{agent.suggested_questions?.length || 0}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Atualizado:</span>
                      <span className="ml-2 font-medium">{new Date(agent.updated_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>
                </div>

                {agent.suggested_questions && agent.suggested_questions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Perguntas Sugeridas:</h4>
                    <div className="flex flex-wrap gap-1">
                      {agent.suggested_questions.slice(0, 3).map((question, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {question.length > 50 ? `${question.substring(0, 50)}...` : question}
                        </Badge>
                      ))}
                      {agent.suggested_questions.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{agent.suggested_questions.length - 3} mais
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {agents.length === 0 && (
          <Card>
            <CardContent className="text-center py-8">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Nenhum agente criado</h3>
              <p className="text-muted-foreground mb-4">
                Crie seu primeiro agente de IA para começar a fazer perguntas aos seus dados.
              </p>
              <Button onClick={() => navigate('/agents/new')} disabled={!canCreateAgent}>
                <Plus className="mr-2 h-4 w-4" />
                Criar Primeiro Agente
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}