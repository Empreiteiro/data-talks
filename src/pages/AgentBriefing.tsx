import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { agentClient, Source } from "@/services/agentClient";
import { useAsync } from "@/hooks/useAsync";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Upload } from "lucide-react";
import { supabaseClient } from "@/services/supabaseClient";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { PlanLimitAlert } from "@/components/PlanLimitAlert";

export default function AgentBriefing() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { value: sources, loading } = useAsync(supabaseClient.listSources);
  const { limits, usage, planName, canCreateAgent, isLoading: limitsLoading } = usePlanLimits();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!canCreateAgent) {
      toast({
        title: "Limite atingido",
        description: `Você atingiu o limite de ${limits.agents} agentes do plano ${planName}.`,
        variant: "destructive",
      });
      return;
    }

    if (!name.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Por favor, informe um nome para o agente.",
        variant: "destructive",
      });
      return;
    }

    if (selectedSources.length === 0) {
      toast({
        title: "Fontes obrigatórias",
        description: "Selecione pelo menos uma fonte de dados.",
        variant: "destructive",
      });
      return;
    }

    if (description.length < 50) {
      toast({
        title: "Descrição insuficiente",
        description: "A descrição deve ter pelo menos 50 caracteres para garantir um bom desempenho do agente.",
        variant: "destructive",
      });
      return;
    }

    try {
      const agent = await supabaseClient.createAgent(name, selectedSources, description);
      toast({
        title: "Agente criado",
        description: "Seu agente foi criado com sucesso!",
      });
      navigate(`/agent/${agent.id}`);
    } catch (error: any) {
      toast({
        title: "Erro ao criar agente",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (loading || limitsLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Carregando fontes...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Criar Agente de IA</h1>
        <p className="text-muted-foreground">
          Configure um agente personalizado para suas fontes de dados ({usage.agents}/{limits.agents} - Plano {planName})
        </p>
      </div>

      {!canCreateAgent && (
        <PlanLimitAlert
          type="agents"
          limit={limits.agents}
          planName={planName}
          className="mb-6"
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informações do Agente</CardTitle>
            <CardDescription>
              Defina o nome e a descrição do seu agente.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                placeholder="Nome do Agente"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                placeholder="Descrição detalhada do agente..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fontes de Dados</CardTitle>
            <CardDescription>
              Selecione as fontes de dados que serão utilizadas pelo agente.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sources">Fontes</Label>
              <Select
                onValueChange={(value) =>
                  setSelectedSources(JSON.parse(value) as string[])
                }
                defaultValue={JSON.stringify(selectedSources)}
              >
                <SelectTrigger id="sources">
                  <SelectValue placeholder="Selecione as fontes de dados..." />
                </SelectTrigger>
                <SelectContent>
                  {sources?.map((source) => (
                    <SelectItem
                      key={source.id}
                      value={JSON.stringify(
                        selectedSources.includes(source.id)
                          ? selectedSources.filter((s) => s !== source.id)
                          : [...selectedSources, source.id]
                      )}
                    >
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              Fontes selecionadas:{" "}
              {sources
                ?.filter((s) => selectedSources.includes(s.id))
                .map((s) => s.name)
                .join(", ") || "Nenhuma"}
            </p>
          </CardContent>
        </Card>
        
        <Button 
          type="submit" 
          disabled={loading || !canCreateAgent} 
          className="w-full"
        >
          {loading ? "Criando..." : "Criar Agente"}
        </Button>
      </form>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Próximos Passos</CardTitle>
          <CardDescription>
            Após criar o agente, você poderá configurá-lo e começar a fazer
            perguntas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p>
            1. **Acesse a página do agente:** Após a criação, você será
            redirecionado para a página do agente, onde poderá ver detalhes e
            configurações.
          </p>
          <p>
            2. **Configure o agente:** Ajuste as configurações do agente para
            otimizar o desempenho e a precisão das respostas.
          </p>
          <p>
            3. **Comece a fazer perguntas:** Utilize o agente para obter
            informações e insights a partir das suas fontes de dados.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
