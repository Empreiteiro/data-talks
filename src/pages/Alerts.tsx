import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabaseClient } from "@/services/supabaseClient";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

const Alerts = () => {
  const [agentId, setAgentId] = useState("");

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => supabaseClient.listAgents()
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts', agentId],
    queryFn: () => supabaseClient.listAlerts(agentId || undefined)
  });

  // Set default agent when agents load
  if (agents.length > 0 && !agentId) {
    setAgentId(agents[0].id);
  }

  function create() {
    alert('Funcionalidade de alertas será implementada em breve.');
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
                  {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name || `${a.id.slice(0,6)}...`}</option>)}
                </select>
              </div>
              <div>
                <Label>Nome do Alerta</Label>
                <Input placeholder="Nome do alerta" />
              </div>
              <div className="md:col-span-2">
                <Label>Pergunta/Query</Label>
                <Input placeholder="Qual pergunta ou condição monitorar?" />
              </div>
              <div>
                <Label>Frequência</Label>
                <select className="w-full border rounded-md px-3 py-2 bg-background">
                  <option value="daily">Diário</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensal</option>
                </select>
              </div>
              <div>
                <Label>E-mail para notificação</Label>
                <Input type="email" placeholder="seu@email.com" />
              </div>
              <div className="md:col-span-2">
                <Button onClick={create}>Criar alerta</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {alerts.length === 0 ? (
              <Card className="shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-center">
                    Nenhum alerta configurado. Crie seu primeiro alerta acima.
                  </p>
                </CardContent>
              </Card>
            ) : (
              alerts.map((a: any) => (
                <Card key={a.id} className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{a.name} · <span className="text-muted-foreground">{a.frequency}</span></CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground">
                      Criado em: {new Date(a.created_at).toLocaleString('pt-BR')}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default Alerts;
