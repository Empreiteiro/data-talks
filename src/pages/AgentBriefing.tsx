import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

import { agentClient, Agent, Source } from "@/services/agentClient";
import { dataClient } from "@/services/supabaseClient";
import { useAuth } from "@/hooks/useAuth";

export default function AgentBriefing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(['']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isEditing = !!id;
  const isCreating = !isEditing;

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    try {
      const sourcesData = await dataClient.listSources();
      setSources(sourcesData);

      if (isEditing) {
        const agentsData = await dataClient.listAgents();
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
          createdAt: agentData.created_at
        };

        setAgent(mappedAgent);
        setName(mappedAgent.name);
        setDescription(mappedAgent.description || '');
        setSelectedSourceIds(agentData.source_ids || []);
        setSuggestedQuestions(agentData.suggested_questions?.length ? agentData.suggested_questions : ['']);
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

    setSaving(true);
    try {
      const filteredQuestions = suggestedQuestions.filter(q => q.trim());
      
      if (isEditing && agent) {
        await dataClient.updateAgent(
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
        await dataClient.createAgent(
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
      await dataClient.deleteAgent(agent.id);
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

  if (loading) {
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : isEditing ? 'Atualizar' : 'Criar'}
          </Button>
        </div>
      </div>

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

      </div>
    </div>
  );
}
