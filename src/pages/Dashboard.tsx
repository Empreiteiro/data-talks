import { SEO } from "@/components/SEO";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { agentClient } from "@/services/agentClient";

const Dashboard = () => {
  const navigate = useNavigate();
  const sources = agentClient.listSources();
  const agents = agentClient.listAgents();
  const alerts = agentClient.listAlerts();

  return (
    <main className="container py-10">
      <SEO title="Dashboard | Converse com seus dados" description="Visão geral das fontes, perguntas e alertas" canonical="/dashboard" />
      <h1 className="text-3xl font-semibold mb-6">Dashboard</h1>
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Fontes de Dados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{sources.length} fonte(s) conectada(s)</p>
            <Button onClick={() => navigate('/sources')}>Adicionar Fonte</Button>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Perguntas & Respostas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{agents.length} agente(s) ativo(s)</p>
            <Button variant="secondary" onClick={() => navigate('/questions')}>Nova Pergunta</Button>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{alerts.length} alerta(s) configurado(s)</p>
            <Button variant="secondary" onClick={() => navigate('/alerts')}>Criar Alerta</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default Dashboard;
