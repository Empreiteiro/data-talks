import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Save, Plus } from "lucide-react";
import { supabaseClient } from "@/services/supabaseClient";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const AgentBriefing = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => supabaseClient.listSources()
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => supabaseClient.listAgents()
  });

  const currentAgent = useMemo(() => agentId ? agents.find(a => a.id === agentId) : undefined, [agentId, agents]);
  const shareLink = useMemo(() => currentAgent ? `${window.location.origin}/share/${currentAgent.share_token}` : "", [currentAgent]);
  const isNewAgent = !agentId;
  const canSave = name.trim().length > 0 && selectedSource.length > 0;

  useEffect(() => {
    if (currentAgent) {
      setName(currentAgent.name || "");
      setDescription(currentAgent.description || "");
      setSelectedSource(currentAgent.source_ids?.[0] || "");
    } else {
      setName("");
      setDescription("");
      setSelectedSource("");
    }
  }, [currentAgent]);

  async function deleteAgent() {
    if (!agentId) return;
    if (confirm(`Tem certeza que deseja deletar o agente "${currentAgent?.name || agentId}"? Esta ação não pode ser desfeita.`)) {
      try {
        setIsLoading(true);
        await supabaseClient.deleteAgent(agentId);
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        setAgentId("");
        toast({
          title: "Agente deletado",
          description: "Agente deletado com sucesso",
        });
      } catch (e: any) {
        toast({
          title: "Erro",
          description: e.message,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    }
  }

  async function save() {
    if (!canSave) return;
    
    try {
      setIsLoading(true);
      
      if (isNewAgent) {
        await supabaseClient.createAgent(name, [selectedSource], description);
        toast({
          title: "Agente criado",
          description: "Agente criado com sucesso",
        });
      } else {
        await supabaseClient.updateAgent(agentId, name, [selectedSource], description);
        toast({
          title: "Agente atualizado", 
          description: "Agente atualizado com sucesso",
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (e: any) {
      toast({
        title: "Erro",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function selectSource(sourceId: string) {
    setSelectedSource(sourceId);
  }

  return (
    <main className="container py-10">
      <SEO title="Agente | Converse com seus dados" description="Defina o contexto e ative o agente" canonical="/agent" />
      <h1 className="text-3xl font-semibold mb-6">Briefing do Agente</h1>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Configurar Agente</CardTitle>
          {currentAgent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteAgent}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Agente</Label>
            <select 
              value={agentId} 
              onChange={(e) => setAgentId(e.target.value)} 
              className="w-full border rounded-md px-3 py-2 bg-background"
              disabled={isLoading}
            >
              <option value="">Novo agente</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name || `${a.id.slice(0,6)}...`}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Nome do agente</Label>
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              placeholder="Ex.: Análises de Vendas 2025"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>Descrição do agente</Label>
            <Textarea 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              placeholder="Descreva o propósito e contexto deste agente. Ex.: Este agente tem acesso aos dados de vendas e pode responder perguntas sobre performance, métricas e análises de vendas do período."
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-3">
            <Label>Fonte de dados</Label>
            {sources.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma fonte de dados encontrada. Adicione fontes primeiro.</p>
            ) : (
              <div className="grid gap-3">
                {sources.map((source: any) => (
                  <div 
                    key={source.id} 
                    className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedSource === source.id 
                        ? 'bg-primary/10 border-primary' 
                        : 'bg-card hover:bg-accent'
                    }`}
                    onClick={() => selectSource(source.id)}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      selectedSource === source.id 
                        ? 'border-primary bg-primary' 
                        : 'border-muted-foreground'
                    }`}>
                      {selectedSource === source.id && (
                        <div className="w-2 h-2 rounded-full bg-primary-foreground"></div>
                      )}
                    </div>
                    <div className="flex-1">
                      <Label className="text-sm font-medium cursor-pointer">
                        {source.name}
                      </Label>
                      <div className="text-xs text-muted-foreground mt-1">
                        Tipo: {source.type.toUpperCase()}
                        {source.metadata?.row_count && (
                          <span> • {source.metadata.row_count.toLocaleString()} linhas</span>
                        )}
                        {source.metadata?.total_tables && (
                          <span> • {source.metadata.total_tables} tabela(s)</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Selecione a fonte de dados que este agente terá acesso para responder perguntas.
            </p>
          </div>

          {currentAgent && (
            <div className="space-y-2">
              <Label>Link compartilhável</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={shareLink} aria-label="Link compartilhável do agente" />
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={() => {
                    navigator.clipboard.writeText(shareLink);
                    toast({
                      title: "Link copiado",
                      description: "Link compartilhável copiado para a área de transferência",
                    });
                  }}
                  disabled={isLoading}
                >
                  Copiar
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button 
              onClick={save} 
              disabled={!canSave || isLoading}
              className="flex items-center gap-2"
            >
              {isNewAgent ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isNewAgent ? "Criar Agente" : "Salvar Alterações"}
            </Button>
            
            {selectedSource && (
              <div className="text-sm text-muted-foreground flex items-center">
                1 fonte selecionada
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
};

export default AgentBriefing;
