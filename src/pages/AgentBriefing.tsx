import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Copy, Share, Eye, EyeOff, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { agentClient, Agent, Source } from "@/services/agentClient";
import { supabaseClient } from "@/services/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { PlanLimitAlert } from "@/components/PlanLimitAlert";

export default function AgentBriefing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { limits, usage, planName, canCreateAgent, isLoading: limitsLoading } = usePlanLimits();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(['']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const isEditing = !!id;
  const isCreating = !isEditing;

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    try {
      const sourcesData = await supabaseClient.listSources();
      setSources(sourcesData);

      if (isEditing) {
        const agentsData = await supabaseClient.listAgents();
        const agentData = agentsData.find(a => a.id === id);
        if (!agentData) {
          toast.error("Agente não encontrado");
          return navigate('/agents');
        }

        const mappedAgent: Agent = {
          id: agentData.id,
          ownerId: user?.id || '',
          name: agentData.name,
          description: agentData.description || '',
          createdAt: agentData.created_at,
          shareToken: agentData.has_share_token ? 'has_token' : ''
        };

        setAgent(mappedAgent);
        setName(mappedAgent.name);
        setDescription(mappedAgent.description || '');
        setSelectedSourceIds(agentData.source_ids || []);
        setSuggestedQuestions(agentData.suggested_questions?.length ? agentData.suggested_questions : ['']);
        setShareEnabled(!!agentData.has_share_token);
        setShareToken(agentData.has_share_token ? 'has_token' : '');
        
        if (agentData.has_share_token && agentData.has_password) {
          setSharePassword('••••••••');
        }
      }
    } catch (error: any) {
      toast.error("Erro ao carregar dados", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Nome obrigatório", {
        description: "Digite um nome para o agente.",
      });
      return;
    }

    if (selectedSourceIds.length === 0) {
      toast.error("Fonte obrigatória", {
        description: "Selecione pelo menos uma fonte de dados.",
      });
      return;
    }

    if (isCreating && !canCreateAgent) {
      toast.error("Limite de agentes atingido", {
        description: `Você atingiu o limite de ${limits.agents} agentes do plano ${planName}.`,
      });
      return;
    }

    setSaving(true);
    try {
      const filteredQuestions = suggestedQuestions.filter(q => q.trim());
      
      if (isEditing && agent) {
        await supabaseClient.updateAgent(
          agent.id, 
          name, 
          selectedSourceIds, 
          description || undefined, 
          filteredQuestions
        );
        toast.success("Agente atualizado", {
          description: "Agente atualizado com sucesso.",
        });
      } else {
        await supabaseClient.createAgent(
          name, 
          selectedSourceIds, 
          description || undefined, 
          filteredQuestions
        );
        toast.success("Agente criado", {
          description: "Agente criado com sucesso.",
        });
      }
      
      navigate('/agents');
    } catch (error: any) {
      toast.error("Erro ao salvar agente", {
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!agent || !confirm('Remover este agente permanentemente?')) return;
    
    setSaving(true);
    try {
      await supabaseClient.deleteAgent(agent.id);
      toast.success("Agente removido", {
        description: "Agente removido com sucesso.",
      });
      navigate('/agents');
    } catch (error: any) {
      toast.error("Erro ao remover agente", {
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSharing() {
    if (!agent) return;

    setSaving(true);
    try {
      const updatedAgent = await supabaseClient.toggleAgentSharing(agent.id, !shareEnabled, sharePassword || undefined);
      if (updatedAgent) {
        setShareEnabled(!!updatedAgent.has_share_token);
        setShareToken(updatedAgent.share_token);
        toast.success(`Compartilhamento ${shareEnabled ? 'desativado' : 'ativado'}`, {
          description: `Link de compartilhamento ${shareEnabled ? 'removido' : 'gerado'} com sucesso.`,
        });
      }
    } catch (error: any) {
      toast.error("Erro ao atualizar compartilhamento", {
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePassword() {
    if (!agent) return;

    setSaving(true);
    try {
      await supabaseClient.updateAgentSharePassword(agent.id, sharePassword || undefined);
      toast.success("Senha atualizada", {
        description: "Senha de compartilhamento atualizada com sucesso.",
      });
    } catch (error: any) {
      toast.error("Erro ao atualizar senha", {
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  }

  const addSuggestedQuestion = () => {
    setSuggestedQuestions([...suggestedQuestions, '']);
  };

  const removeSuggestedQuestion = (index: number) => {
    setSuggestedQuestions(suggestedQuestions.filter((_, i) => i !== index));
  };

  const updateSuggestedQuestion = (index: number, value: string) => {
    const updated = [...suggestedQuestions];
    updated[index] = value;
    setSuggestedQuestions(updated);
  };

  if (loading || limitsLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Carregando agente...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/agents')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {isEditing ? 'Editar Agente' : 'Criar Agente'}
            </h1>
          </div>
        </div>
        <div className="flex gap-2">
          {isEditing && (
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remover
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || (isCreating && !canCreateAgent)}>
            {saving ? 'Salvando...' : isEditing ? 'Atualizar' : 'Criar'}
          </Button>
        </div>
      </div>

      {isCreating && !canCreateAgent && (
        <PlanLimitAlert
          type="agents"
          limit={limits.agents}
          planName={planName}
          className="mb-6"
        />
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Informações Básicas</CardTitle>
            <CardDescription>
              Configure as informações básicas do seu agente de IA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome do Agente</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Assistente de Vendas"
                disabled={saving}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o propósito do seu agente..."
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fontes de Dados</CardTitle>
            <CardDescription>
              Selecione as fontes de dados que o agente deve usar para responder perguntas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sources.map((source) => (
                <div key={source.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={source.id}
                    checked={selectedSourceIds.includes(source.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedSourceIds([...selectedSourceIds, source.id]);
                      } else {
                        setSelectedSourceIds(selectedSourceIds.filter(id => id !== source.id));
                      }
                    }}
                    disabled={saving}
                  />
                  <Label htmlFor={source.id} className="flex items-center gap-2">
                    {source.name}
                    <Badge variant="secondary">{source.type}</Badge>
                  </Label>
                </div>
              ))}
              {sources.length === 0 && (
                <p className="text-muted-foreground">
                  Nenhuma fonte de dados disponível. 
                  <Button variant="link" onClick={() => navigate('/sources')} className="p-0 ml-1">
                    Criar fonte de dados
                  </Button>
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Perguntas Sugeridas</CardTitle>
            <CardDescription>
              Configure perguntas que os usuários podem fazer rapidamente ao agente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggestedQuestions.map((question, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={question}
                  onChange={(e) => updateSuggestedQuestion(index, e.target.value)}
                  placeholder="Ex: Qual foi o faturamento do mês passado?"
                  disabled={saving}
                />
                {suggestedQuestions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSuggestedQuestion(index)}
                    disabled={saving}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={addSuggestedQuestion}
              disabled={saving}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Pergunta
            </Button>
          </CardContent>
        </Card>

        {isEditing && (
          <Card>
            <CardHeader>
              <CardTitle>Compartilhamento</CardTitle>
              <CardDescription>
                Configure o compartilhamento público do agente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-base">Compartilhamento Público</div>
                  <div className="text-sm text-muted-foreground">
                    Permitir que outras pessoas acessem este agente via link
                  </div>
                </div>
                <Switch
                  checked={shareEnabled}
                  onCheckedChange={handleToggleSharing}
                  disabled={saving}
                />
              </div>

              {shareEnabled && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="grid gap-2">
                    <Label>Link de Compartilhamento</Label>
                    <div className="flex gap-2">
                      <Input
                        value={shareToken ? `${window.location.origin}/share/agent/${shareToken}` : ''}
                        readOnly
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (shareToken) {
                            navigator.clipboard.writeText(`${window.location.origin}/share/agent/${shareToken}`);
                            toast.success("Link copiado!");
                          }
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="sharePassword">Senha de Proteção (opcional)</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="sharePassword"
                          type={showPassword ? "text" : "password"}
                          value={sharePassword}
                          onChange={(e) => setSharePassword(e.target.value)}
                          placeholder="Digite uma senha opcional"
                          disabled={saving}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                          disabled={saving}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleUpdatePassword}
                        disabled={saving}
                      >
                        Atualizar
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Se definida, os usuários precisarão desta senha para acessar o agente
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
