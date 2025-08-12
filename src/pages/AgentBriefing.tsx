import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { agentClient } from "@/services/agentClient";
import { useEffect, useMemo, useState } from "react";

const AgentBriefing = () => {
  const sources = agentClient.listSources();
  const agents = agentClient.listAgents();
  const [agentId, setAgentId] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const currentAgent = useMemo(() => agentId ? agentClient.getAgent(agentId) : undefined, [agentId]);
  const shareLink = useMemo(() => currentAgent ? `${window.location.origin}/share/${currentAgent.shareToken}` : "", [currentAgent]);
  const minExceeded = useMemo(() => description.trim().length >= 200, [description]);

  useEffect(() => {
    if (agentId) {
      const a = agentClient.getAgent(agentId);
      setName(a?.name || "");
      setDescription(a?.description || "");
      setSelected(agentClient.getAgentSourceIds(agentId));
      setSharePassword(a?.sharePassword || "");
    } else {
      setName("");
      setDescription("");
      setSelected([]);
      setSharePassword("");
    }
  }, [agentId]);

  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function save() {
    try {
      if (!agentId) {
        const agent = agentClient.createBriefing(selected, description, name);
        if (sharePassword) agentClient.setAgentShare(agent.id, sharePassword);
        setAgentId(agent.id);
        setMsg(`Agente criado: ${agent.name || agent.id}`);
      } else {
        const agent = agentClient.updateAgent(agentId, { name, description, sourceIds: selected });
        agentClient.setAgentShare(agentId, sharePassword);
        setMsg(`Agente atualizado: ${agent.name || agent.id}`);
      }
    } catch (e:any) { setMsg((e as any).message || 'Erro ao salvar'); }
  }

  return (
    <main className="container py-10">
      <SEO title="Agente | Converse com seus dados" description="Defina o contexto e ative o agente" canonical="/agent" />
      <h1 className="text-3xl font-semibold mb-6">Briefing do Agente</h1>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Configurar Agente</CardTitle>
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
            {sources.map((s) => (
              <label key={s.id} className="flex items-center gap-3 bg-secondary rounded-md px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                <span className="text-sm">{s.name} <span className="text-muted-foreground">[{s.type}]</span></span>
              </label>
            ))}
          </div>

          <div className="space-y-2">
            <Label>Nome do agente</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Análises de Vendas 2025" />
          </div>
          <div className="space-y-2">
            <Label>Descrição dos dados e tabelas (mín. 200 caracteres)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Ex.: Vendas mensais no dataset analytics, tabelas orders (id, date, amount, region) ..." />
            <p className="text-xs text-muted-foreground">{description.trim().length} / 200</p>
          </div>

          <div className="space-y-2">
            <Label>Senha para compartilhamento (opcional)</Label>
            <Input type="password" value={sharePassword} onChange={(e) => setSharePassword(e.target.value)} placeholder="Defina uma senha para o link compartilhável" />
          </div>

          {currentAgent && (
            <div className="space-y-2">
              <Label>Link compartilhável</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={shareLink} aria-label="Link compartilhável do agente" />
                <Button type="button" variant="secondary" onClick={() => navigator.clipboard.writeText(shareLink)}>Copiar</Button>
              </div>
              <p className="text-xs text-muted-foreground">Este link exige a senha para acesso.</p>
            </div>
          )}

          <Button onClick={save} disabled={!selected.length || !minExceeded || !name.trim().length}>Salvar</Button>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>
    </main>
  );
};

export default AgentBriefing;
