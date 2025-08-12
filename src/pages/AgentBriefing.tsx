import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { supabaseClient } from "@/services/supabaseClient";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const AgentBriefing = () => {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

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
  const minExceeded = useMemo(() => description.trim().length >= 200, [description]);

  useEffect(() => {
    if (currentAgent) {
      setName(currentAgent.name || "");
      setDescription("Agente configurado no Supabase");
    } else {
      setName("");
      setDescription("");
    }
  }, [currentAgent]);

  async function deleteAgent() {
    if (!agentId) return;
    if (confirm(`Tem certeza que deseja deletar o agente "${currentAgent?.name || agentId}"? Esta ação não pode ser desfeita.`)) {
      try {
        await supabaseClient.deleteAgent(agentId);
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        setAgentId("");
        setMsg("Agente deletado com sucesso");
      } catch (e: any) {
        alert(e.message);
      }
    }
  }

  function save() {
    setMsg("Para criar/editar agentes, use o painel do Supabase por enquanto.");
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
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Agente</Label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full border rounded-md px-3 py-2 bg-background">
              <option value="">Novo agente</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name || `${a.id.slice(0,6)}...`}</option>
              ))}
            </select>
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            {sources.length === 0 ? (
              <p className="text-muted-foreground col-span-2">Nenhuma fonte de dados encontrada. Adicione fontes primeiro.</p>
            ) : (
              sources.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 bg-secondary rounded-md px-3 py-2">
                  <span className="text-sm">{s.name} <span className="text-muted-foreground">[{s.type}]</span></span>
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            <Label>Nome do agente</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Análises de Vendas 2025" />
          </div>
          <div className="space-y-2">
            <Label>Descrição dos dados e tabelas</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Configuração gerenciada no Supabase" readOnly />
            <p className="text-xs text-muted-foreground">Use o painel do Supabase para criar/editar agentes</p>
          </div>

          {currentAgent && (
            <div className="space-y-2">
              <Label>Link compartilhável</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={shareLink} aria-label="Link compartilhável do agente" />
                <Button type="button" variant="secondary" onClick={() => navigator.clipboard.writeText(shareLink)}>Copiar</Button>
              </div>
            </div>
          )}

          <Button onClick={save}>Informações sobre configuração</Button>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>
    </main>
  );
};

export default AgentBriefing;
