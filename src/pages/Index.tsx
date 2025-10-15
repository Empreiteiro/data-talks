import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Grid3x3, List, MoreVertical, Pencil } from "lucide-react";
import { supabaseClient } from "@/services/supabaseClient";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
interface Agent {
  id: string;
  name: string;
  description?: string;
  source_ids: string[];
  created_at: string;
}
const Index = () => {
  const {
    isAuthenticated,
    initializing
  } = useAuth();
  const {
    t
  } = useLanguage();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [newName, setNewName] = useState("");
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
      toast.error("Erro ao carregar workspaces", {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  }
  const handleCreateWorkspace = async () => {
    try {
      const newAgent = await supabaseClient.createAgent("Novo espaço de trabalho", [], "", []);
      navigate(`/workspace/${newAgent.id}?openAddSource=true`);
    } catch (error: any) {
      toast.error("Erro ao criar workspace", {
        description: error.message
      });
    }
  };
  const handleRenameWorkspace = (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    setNewName(agent.name);
    setRenameDialogOpen(true);
  };
  const handleConfirmRename = async () => {
    if (!selectedAgent || !newName.trim()) return;
    try {
      await supabaseClient.updateAgent(selectedAgent.id, newName, selectedAgent.source_ids, selectedAgent.description || "", []);
      toast.success("Workspace renomeado com sucesso");
      loadAgents();
      setRenameDialogOpen(false);
    } catch (error: any) {
      toast.error("Erro ao renomear workspace", {
        description: error.message
      });
    }
  };
  const handleDeleteWorkspace = async (agentId: string, agentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Tem certeza que deseja excluir o workspace "${agentName}"? Esta ação não pode ser desfeita.`)) {
      return;
    }
    try {
      await supabaseClient.deleteAgent(agentId);
      toast.success("Workspace excluído com sucesso");
      loadAgents(); // Recarrega a lista
    } catch (error: any) {
      toast.error("Erro ao excluir workspace", {
        description: error.message
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
    return <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>;
  }
  return <div className="min-h-screen bg-background">
      <SEO title="Workspaces" description="Gerencie seus workspaces" canonical="/" />
      
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">Workspaces</h1>

          <div className="flex items-center gap-2">
            <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => setViewMode("grid")}>
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" onClick={() => setViewMode("list")}>
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

            <Button onClick={handleCreateWorkspace}>
              <Plus className="h-4 w-4 mr-2" />
              Novo workspace
            </Button>
          </div>
        </div>


        {viewMode === "grid" ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Create new card */}
            <Card className="p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors min-h-[200px]" onClick={handleCreateWorkspace}>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <p className="font-medium">Criar novo workspace</p>
            </Card>

            {sortedAgents.map((agent, index) => <Card key={agent.id} className="p-6 cursor-pointer hover:shadow-md transition-shadow min-h-[200px] flex flex-col" onClick={() => navigate(`/workspace/${agent.id}`)}>
                <div className="flex items-start justify-between mb-3">
                  <div className="text-3xl">{getEmoji(index)}</div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                    <DropdownMenuItem onClick={e => {
                  e.stopPropagation();
                  navigate(`/workspace/${agent.id}`);
                }}>
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => handleRenameWorkspace(agent, e)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Renomear
                    </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={e => handleDeleteWorkspace(agent.id, agent.name, e)}>
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <h3 className="font-semibold text-lg mb-4 line-clamp-2">{agent.name}</h3>
                
                <div className="mt-auto pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    {new Date(agent.created_at).toLocaleDateString('pt-BR')} • {agent.source_ids?.length || 0} fontes
                  </p>
                </div>
              </Card>)}
          </div> : <div className="space-y-2">
            {/* Create new list item */}
            <Card className="p-4 flex items-center gap-4 cursor-pointer hover:bg-accent/50 transition-colors" onClick={handleCreateWorkspace}>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <p className="font-medium">Criar novo workspace</p>
            </Card>

            {sortedAgents.map((agent, index) => <Card key={agent.id} className="p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/workspace/${agent.id}`)}>
                <div className="text-2xl flex-shrink-0">{getEmoji(index)}</div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate mb-1">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {new Date(agent.created_at).toLocaleDateString('pt-BR')} • {agent.source_ids?.length || 0} fontes
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={e => {
                e.stopPropagation();
                navigate(`/workspace/${agent.id}`);
              }}>
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => handleRenameWorkspace(agent, e)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Renomear
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={e => handleDeleteWorkspace(agent.id, agent.name, e)}>
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Card>)}
          </div>}
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear workspace</DialogTitle>
            <DialogDescription>
              Digite o novo nome para o workspace
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome do workspace" onKeyDown={e => {
              if (e.key === 'Enter') {
                handleConfirmRename();
              }
            }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmRename} disabled={!newName.trim()}>
              Renomear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>;
};
export default Index;