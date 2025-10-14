import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Grid3x3, List, MoreVertical } from "lucide-react";
import { supabaseClient } from "@/services/supabaseClient";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Agent {
  id: string;
  name: string;
  description?: string;
  source_ids: string[];
  created_at: string;
}

const Index = () => {
  const { isAuthenticated, initializing } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    if (!initializing && isAuthenticated) {
      loadAgents();
    }
  }, [isAuthenticated, initializing]);

  async function loadAgents() {
    try {
      const data = await supabaseClient.listAgents();
      setAgents(data || []);
    } catch (error: any) {
      toast.error("Erro ao carregar notebooks", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  const getEmoji = (index: number) => {
    const emojis = ["📊", "🎯", "💡", "🚀", "📈", "🔍", "💼", "🎨", "⚡"];
    return emojis[index % emojis.length];
  };

  if (!isAuthenticated && !initializing) {
    navigate('/login');
    return null;
  }

  if (loading || initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Notebooks" description="Gerencie seus notebooks" canonical="/" />
      
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm">
              Todos
            </Button>
            <Button variant="ghost" size="sm">
              Meus notebooks
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("grid")}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Mais recentes
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Mais recentes</DropdownMenuItem>
                <DropdownMenuItem>Mais antigos</DropdownMenuItem>
                <DropdownMenuItem>Nome (A-Z)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={() => navigate('/agents/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Novo notebook
            </Button>
          </div>
        </div>

        <h2 className="text-2xl font-semibold mb-6">Notebooks recentes</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Create new card */}
          <Card
            className="p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors min-h-[200px]"
            onClick={() => navigate('/agents/new')}
          >
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Plus className="h-6 w-6 text-primary" />
            </div>
            <p className="font-medium">Criar novo notebook</p>
          </Card>

          {agents.map((agent, index) => (
            <Card
              key={agent.id}
              className="p-6 cursor-pointer hover:shadow-md transition-shadow min-h-[200px] flex flex-col"
              onClick={() => navigate(`/notebook/${agent.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-3xl">{getEmoji(index)}</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/agents/${agent.id}`);
                    }}>
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Implementar delete
                      }}
                    >
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <h3 className="font-semibold mb-2 line-clamp-2">{agent.name}</h3>
              
              <div className="mt-auto pt-4">
                <p className="text-xs text-muted-foreground">
                  {new Date(agent.created_at).toLocaleDateString('pt-BR')} • {agent.source_ids?.length || 0} fontes
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
