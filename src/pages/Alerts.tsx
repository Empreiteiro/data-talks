import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabaseClient } from "@/services/supabaseClient";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const Alerts = () => {
  const [agentId, setAgentId] = useState("");
  const [alertName, setAlertName] = useState("");
  const [question, setQuestion] = useState("");
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [isCreating, setIsCreating] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  async function createAlert() {
    if (!agentId || !alertName || !question || !email) {
      toast({
        title: "Erro",
        description: "Preencha todos os campos obrigatórios",
        variant: "destructive"
      });
      return;
    }
    
    try {
      setIsCreating(true);
      await supabaseClient.createAlert(agentId, alertName, question, email, frequency);
      
      // Clear form
      setAlertName("");
      setQuestion("");
      setEmail("");
      setFrequency("daily");
      
      // Refresh alerts list
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      
      toast({
        title: "Sucesso",
        description: "Alerta criado com sucesso!"
      });
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message || "Erro ao criar alerta",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
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
                <Label htmlFor="agent-select">Agente</Label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um agente" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || `${a.id.slice(0,6)}...`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="alert-name">Nome do Alerta</Label>
                <Input 
                  id="alert-name"
                  placeholder="Nome do alerta" 
                  value={alertName}
                  onChange={(e) => setAlertName(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="question">Pergunta/Query</Label>
                <Input 
                  id="question"
                  placeholder="Qual pergunta ou condição monitorar?" 
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="frequency">Frequência</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Diário</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="email">E-mail para notificação</Label>
                <Input 
                  id="email"
                  type="email" 
                  placeholder="seu@email.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Button onClick={createAlert} disabled={isCreating}>
                  {isCreating ? "Criando..." : "Criar alerta"}
                </Button>
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
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{a.name} · <span className="text-muted-foreground">{a.frequency}</span></span>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => supabaseClient.deleteAlert(a.id).then(() => {
                          queryClient.invalidateQueries({ queryKey: ['alerts'] });
                          toast({
                            title: "Sucesso", 
                            description: "Alerta removido"
                          });
                        })}
                      >
                        Remover
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm">
                      <strong>Pergunta:</strong> {a.question}
                    </div>
                    <div className="text-sm">
                      <strong>Email:</strong> {a.email}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Criado em: {new Date(a.created_at).toLocaleString('pt-BR')}
                      {a.next_run && (
                        <span> · Próxima execução: {new Date(a.next_run).toLocaleString('pt-BR')}</span>
                      )}
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
