import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { agentClient } from "@/services/agentClient";
import { useMemo, useState } from "react";

const Alerts = () => {
  const agents = agentClient.listAgents();
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [tableRef, setTableRef] = useState("");
  const [conditionExpr, setCondition] = useState("");
  const [frequency, setFrequency] = useState<'minute'|'hour'|'daily'|'weekly'>('daily');
  const [channel, setChannel] = useState<'in-app'|'email'>('in-app');

  const alerts = useMemo(() => agentClient.listAlerts(agentId), [agentId]);

  function create() {
    if (!agentId || !tableRef || !conditionExpr) return alert('Preencha todos os campos');
    agentClient.createAlert({ agentId, tableRef, conditionExpr, frequency, channel });
  }

  return (
    <main className="container py-10">
      <SEO title="Alertas | Converse com seus dados" description="Crie alertas recorrentes" canonical="/alerts" />
      <h1 className="text-3xl font-semibold mb-6">Alertas</h1>

      {agents.length === 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Antes de começar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Crie um agente para vincular os alertas.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Novo Alerta</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Agente</Label>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full border rounded-md px-3 py-2 bg-background">
                  {agents.map(a => <option key={a.id} value={a.id}>{a.id.slice(0,6)}...</option>)}
                </select>
              </div>
              <div>
                <Label>Tabela</Label>
                <Input value={tableRef} onChange={(e) => setTableRef(e.target.value)} placeholder="analytics.orders" />
              </div>
              <div className="md:col-span-2">
                <Label>Condição/Consulta</Label>
                <Input value={conditionExpr} onChange={(e) => setCondition(e.target.value)} placeholder="> 1000, erro != 0, etc." />
              </div>
              <div>
                <Label>Frequência</Label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as any)} className="w-full border rounded-md px-3 py-2 bg-background">
                  <option value="minute">Minuto</option>
                  <option value="hour">Hora</option>
                  <option value="daily">Diário</option>
                  <option value="weekly">Semanal</option>
                </select>
              </div>
              <div>
                <Label>Canal</Label>
                <select value={channel} onChange={(e) => setChannel(e.target.value as any)} className="w-full border rounded-md px-3 py-2 bg-background">
                  <option value="in-app">In-app</option>
                  <option value="email">E-mail</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Button onClick={create}>Criar alerta</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {alerts.map(a => (
              <Card key={a.id} className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">{a.tableRef} · <span className="text-muted-foreground">{a.frequency} · {a.channel}</span></CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Última execução: {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : '—'} · Próxima: {a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : '—'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => agentClient.testAlert(a.id)}>Testar</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </main>
  );
};

export default Alerts;
