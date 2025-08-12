import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { agentClient } from "@/services/agentClient";
import { useMemo, useState } from "react";

const AgentBriefing = () => {
  const sources = agentClient.listSources();
  const [selected, setSelected] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const minExceeded = useMemo(() => description.trim().length >= 200, [description]);

  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function activate() {
    try {
      const agent = agentClient.createBriefing(selected, description);
      setMsg(`Agente ativado: ${agent.id}`);
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <main className="container py-10">
      <SEO title="Agente | Converse com seus dados" description="Defina o contexto e ative o agente" canonical="/agent" />
      <h1 className="text-3xl font-semibold mb-6">Briefing do Agente</h1>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Selecione as fontes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-2">
            {sources.map((s) => (
              <label key={s.id} className="flex items-center gap-3 bg-secondary rounded-md px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                <span className="text-sm">{s.name} <span className="text-muted-foreground">[{s.type}]</span></span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Descrição dos dados e tabelas (mín. 200 caracteres)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} placeholder="Ex.: Vendas mensais no dataset analytics, tabelas orders (id, date, amount, region) ..." />
            <p className="text-xs text-muted-foreground">{description.trim().length} / 200</p>
          </div>
          <Button onClick={activate} disabled={!selected.length || !minExceeded}>Ativar agente</Button>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>
    </main>
  );
};

export default AgentBriefing;
