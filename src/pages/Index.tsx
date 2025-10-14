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
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");

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

  const handleCreateNotebook = async () => {
    try {
      const newAgent = await supabaseClient.createAgent(
        "Novo Notebook",
        [],
        "",
        []
      );
      
      navigate(`/notebook/${newAgent.id}?openAddSource=true`);
    } catch (error: any) {
      toast.error("Erro ao criar notebook", {
        description: error.message,
      });
    }
  };

  const getEmoji = (index: number) => {
    const emojis = ["📊", "🎯", "💡", "🚀", "📈", "🔍", "💼", "🎨", "⚡"];
    return emojis[index % emojis.length];
  };

  const sortedAgents = [...agents].sort((a, b) => {
    switch (sortBy) {
      case "newest":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "oldest":
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "name":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

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
          <h1 className="text-2xl font-semibold">Notebooks recentes</h1>

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
                  {sortBy === "newest" && "Mais recentes"}
                  {sortBy === "oldest" && "Mais antigos"}
                  {sortBy === "name" && "Nome (A-Z)"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setSortBy("newest")}>
                  Mais recentes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("oldest")}>
                  Mais antigos
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("name")}>
                  Nome (A-Z)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={handleCreateNotebook}>
              <Plus className="h-4 w-4 mr-2" />
              Novo notebook
            </Button>
          </div>
        </div>


        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Create new card */}
            <Card
              className="p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors min-h-[200px]"
              onClick={handleCreateNotebook}
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <p className="font-medium">Criar novo notebook</p>
            </Card>

            {sortedAgents.map((agent, index) => (
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
                      navigate(`/notebook/${agent.id}`);
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

                <h3 className="font-semibold mb-4 line-clamp-2">{agent.name}</h3>
                
                <div className="mt-auto pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    {new Date(agent.created_at).toLocaleDateString('pt-BR')} • {agent.source_ids?.length || 0} fontes
                  </p>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Create new list item */}
            <Card
              className="p-4 flex items-center gap-4 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={handleCreateNotebook}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <p className="font-medium">Criar novo notebook</p>
            </Card>

            {sortedAgents.map((agent, index) => (
              <Card
                key={agent.id}
                className="p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/notebook/${agent.id}`)}
              >
                <div className="text-2xl flex-shrink-0">{getEmoji(index)}</div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate mb-1">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {new Date(agent.created_at).toLocaleDateString('pt-BR')} • {agent.source_ids?.length || 0} fontes
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/notebook/${agent.id}`);
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
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
