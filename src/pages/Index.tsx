import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageWalkthrough } from "@/contexts/WalkthroughContext";
import { indexSteps } from "@/components/walkthrough/steps/indexSteps";
import { useAuth } from "@/hooks/useAuth";
import { dataClient } from "@/services/dataClient";
import { BarChart3, Database, Grid3x3, Layout, List, MoreVertical, Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Auth from "@/pages/Auth";
import { toast } from "sonner";
interface Agent {
  id: string;
  name: string;
  description?: string;
  workspace_type?: string;
  source_ids: string[];
  created_at: string;
  source_count?: number;
}

const WORKSPACE_TYPES = [
  { id: "analysis", label: "Data Analysis", icon: BarChart3, description: "Ask questions about your data, generate reports and charts" },
  { id: "cdp", label: "Customer Data Platform", icon: Users, description: "Unify customer data, create segments, and activate audiences" },
  { id: "etl", label: "ETL Pipeline", icon: RefreshCw, description: "Transform and orchestrate data pipelines between sources" },
] as const;

interface Dashboard {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  chart_count?: number;
}

/** Set to true to show Dashboard section on the home page. */
const SHOW_DASHBOARDS = false;

const Index = () => {
  const { isAuthenticated, initializing, loginRequired } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  usePageWalkthrough('index', indexSteps);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [newName, setNewName] = useState("");
  const [createDashboardDialogOpen, setCreateDashboardDialogOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState("");
  const [newDashboardDescription, setNewDashboardDescription] = useState("");
  useEffect(() => {
    window.scrollTo(0, 0);
    if (!initializing && isAuthenticated) {
      loadAgents();
      if (SHOW_DASHBOARDS) loadDashboards();
    } else if (!initializing) {
      setLoading(false);
    }
  }, [isAuthenticated, initializing]);

  async function loadAgents() {
    try {
      const data = await dataClient.listAgents();
      setAgents(data || []);
    } catch (error) {
      toast.error("Erro ao carregar workspaces", {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboards() {
    try {
      const data = await dataClient.listDashboards();
      setDashboards((data || []) as unknown as Dashboard[]);
    } catch (error) {
      toast.error(t('dashboard.loadError'), {
        description: error.message
      });
    }
  }
  const [workspaceTypeDialogOpen, setWorkspaceTypeDialogOpen] = useState(false);

  const handleCreateWorkspace = () => {
    setWorkspaceTypeDialogOpen(true);
  };

  const handleCreateWorkspaceWithType = async (workspaceType: string) => {
    setWorkspaceTypeDialogOpen(false);
    try {
      const typeLabel = WORKSPACE_TYPES.find(t => t.id === workspaceType)?.label || "Workspace";
      const newAgent = await dataClient.createAgent(`New ${typeLabel}`, [], "", [], undefined, workspaceType) as { id: string };
      navigate(`/workspace/${newAgent.id}?openAddSource=true`);
    } catch (error) {
      toast.error(t('workspace.errorCreatingWorkspace'), {
        description: error.message
      });
    }
  };

  const handleCreateDashboard = async () => {
    if (!newDashboardName.trim()) return;
    
    try {
      const dashboard = await dataClient.createDashboard(
        newDashboardName.trim(),
        newDashboardDescription.trim() || undefined
      ) as { id: string };
      
      toast.success(t('dashboard.createSuccess'));
      setCreateDashboardDialogOpen(false);
      setNewDashboardName("");
      setNewDashboardDescription("");
      loadDashboards();
      navigate(`/dashboard/${dashboard.id}`);
    } catch (error) {
      toast.error(t('dashboard.createError'), {
        description: error.message
      });
    }
  };

  const handleDeleteDashboard = async (dashboardId: string, dashboardName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm(t('dashboard.deleteConfirm', { name: dashboardName }))) {
      return;
    }
    
    try {
      await dataClient.deleteDashboard(dashboardId);
      toast.success(t('dashboard.deleteSuccess'));
      loadDashboards();
    } catch (error) {
      toast.error(t('dashboard.deleteError'), {
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
      await dataClient.updateAgent(selectedAgent.id, newName, selectedAgent.source_ids, selectedAgent.description || "", []);
      toast.success(t('workspace.renameSuccess'));
      loadAgents();
      setRenameDialogOpen(false);
    } catch (error) {
      toast.error(t('workspace.renameError'), {
        description: error.message
      });
    }
  };
  const handleDeleteWorkspace = async (agentId: string, agentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t('workspace.deleteConfirm', { name: agentName }))) {
      return;
    }
    try {
      await dataClient.deleteAgent(agentId);
      toast.success(t('workspace.deleteSuccess'));
      loadAgents();
    } catch (error) {
      toast.error(t('workspace.deleteError'), {
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
  if (!isAuthenticated && !initializing && loginRequired) {
    return <Auth />;
  }
  if (loading || initializing) {
    return <div className="min-h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>;
  }
  return <div className="min-h-full bg-background">
      <SEO title={t('workspace.title')} description={t('workspace.description')} canonical="/" />
      
      <div className="w-full max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center mb-8" data-walkthrough="index-hero">
          <h1 className="text-2xl font-semibold">{t('workspace.title')}</h1>

          <div className="flex items-center gap-2 ml-auto" data-walkthrough="index-view-controls">
            <Button variant={viewMode === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => setViewMode("grid")}>
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" onClick={() => setViewMode("list")}>
              <List className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {sortBy === "newest" && t('workspace.mostRecent')}
                  {sortBy === "oldest" && t('workspace.oldest')}
                  {sortBy === "name" && t('workspace.nameAZ')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setSortBy("newest")}>
                  {t('workspace.mostRecent')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("oldest")}>
                  {t('workspace.oldest')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("name")}>
                  {t('workspace.nameAZ')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button onClick={handleCreateWorkspace} data-walkthrough="index-create-btn">
              <Plus className="h-4 w-4 mr-2" />
              {t('workspace.newWorkspace')}
            </Button>
          </div>
        </div>

        {viewMode === "grid" ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4" data-walkthrough="index-agents-grid">
            {/* Create new card */}
            <Card className="p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors min-h-[200px]" onClick={handleCreateWorkspace}>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Plus className="h-6 w-6 text-primary" />
              </div>
              <p className="font-medium">{t('workspace.createNewWorkspace')}</p>
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
                      {t('workspace.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => handleRenameWorkspace(agent, e)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      {t('workspace.rename')}
                    </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={e => handleDeleteWorkspace(agent.id, agent.name, e)}>
                        {t('workspace.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <h3 className="font-semibold text-lg mb-1 line-clamp-2">{agent.name}</h3>
                {agent.workspace_type && agent.workspace_type !== "analysis" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 uppercase">
                    {agent.workspace_type}
                  </span>
                )}

                <div className="mt-auto pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    {new Date(agent.created_at).toLocaleDateString(t('questions.dateFormat'))} • {agent.source_count || 0} {(agent.source_count || 0) === 1 ? t('workspace.source') : t('workspace.sources')}
                  </p>
                </div>
              </Card>)}
          </div> : <div className="space-y-2" data-walkthrough="index-agents-grid">
            {/* Create new list item */}
            <Card className="p-4 flex items-center gap-4 cursor-pointer hover:bg-accent/50 transition-colors" onClick={handleCreateWorkspace}>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <p className="font-medium">{t('workspace.createNewWorkspace')}</p>
            </Card>

            {sortedAgents.map((agent, index) => <Card key={agent.id} className="p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/workspace/${agent.id}`)}>
                <div className="text-2xl flex-shrink-0">{getEmoji(index)}</div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg truncate mb-1">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {new Date(agent.created_at).toLocaleDateString(t('questions.dateFormat'))} • {agent.source_count || 0} {(agent.source_count || 0) === 1 ? t('workspace.source') : t('workspace.sources')}
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
                      {t('workspace.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={e => handleRenameWorkspace(agent, e)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      {t('workspace.rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={e => handleDeleteWorkspace(agent.id, agent.name, e)}>
                      {t('workspace.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Card>)}
          </div>}

        {SHOW_DASHBOARDS && (
        <>
        {/* Dashboards Section - hidden when SHOW_DASHBOARDS is false */}
        <div className="mt-16">
          <div className="flex items-center mb-8">
            <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>

            <div className="flex items-center gap-2 ml-auto">
              <Button onClick={() => setCreateDashboardDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t('dashboard.createNew')}
              </Button>
            </div>
          </div>

          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
              {/* Create new dashboard card */}
              <Card 
                className="p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-accent/50 transition-colors min-h-[200px]" 
                onClick={() => setCreateDashboardDialogOpen(true)}
              >
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-3">
                  <Layout className="h-6 w-6 text-blue-500" />
                </div>
                <p className="font-medium">{t('dashboard.createNewDashboard')}</p>
              </Card>

              {dashboards.map((dashboard, index) => (
                <Card 
                  key={dashboard.id} 
                  className="p-6 cursor-pointer hover:shadow-md transition-shadow min-h-[200px] flex flex-col" 
                  onClick={() => navigate(`/dashboard/${dashboard.id}`)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-3xl">📊</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={e => {
                          e.stopPropagation();
                          navigate(`/dashboard/${dashboard.id}`);
                        }}>
                          {t('dashboard.view')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => {
                          e.stopPropagation();
                          // TODO: Implement rename dashboard
                        }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t('dashboard.rename')}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive" 
                          onClick={e => handleDeleteDashboard(dashboard.id, dashboard.name, e)}
                        >
                          {t('dashboard.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <h3 className="font-semibold text-lg mb-2 line-clamp-2">{dashboard.name}</h3>
                  {dashboard.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{dashboard.description}</p>
                  )}
                  
                  <div className="mt-auto pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      {new Date(dashboard.created_at).toLocaleDateString()} • {dashboard.chart_count || 0} {(dashboard.chart_count || 0) === 1 ? t('dashboard.chart') : t('dashboard.charts')}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Create new dashboard list item */}
              <Card 
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-accent/50 transition-colors" 
                onClick={() => setCreateDashboardDialogOpen(true)}
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <Layout className="h-5 w-5 text-blue-500" />
                </div>
                <p className="font-medium">{t('dashboard.createNewDashboard')}</p>
              </Card>

              {dashboards.map((dashboard) => (
                <Card 
                  key={dashboard.id} 
                  className="p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow" 
                  onClick={() => navigate(`/dashboard/${dashboard.id}`)}
                >
                  <div className="text-2xl flex-shrink-0">📊</div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg truncate mb-1">{dashboard.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(dashboard.created_at).toLocaleDateString()} • {dashboard.chart_count || 0} {(dashboard.chart_count || 0) === 1 ? t('dashboard.chart') : t('dashboard.charts')}
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
                        navigate(`/dashboard/${dashboard.id}`);
                      }}>
                        {t('dashboard.view')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={e => {
                        e.stopPropagation();
                        // TODO: Implement rename dashboard
                      }}>
                        <Pencil className="h-4 w-4 mr-2" />
                        {t('dashboard.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onClick={e => handleDeleteDashboard(dashboard.id, dashboard.name, e)}
                      >
                        {t('dashboard.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Card>
              ))}
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace.renameWorkspace')}</DialogTitle>
            <DialogDescription>
              {t('workspace.renameDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('workspace.name')}</Label>
              <Input id="name" value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('workspace.name')} onKeyDown={e => {
              if (e.key === 'Enter') {
                handleConfirmRename();
              }
            }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              {t('workspace.cancel')}
            </Button>
            <Button onClick={handleConfirmRename} disabled={!newName.trim()}>
              {t('workspace.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {SHOW_DASHBOARDS && (
      <Dialog open={createDashboardDialogOpen} onOpenChange={setCreateDashboardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.createNewDashboard')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.createDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dashboard-name">{t('dashboard.name')}</Label>
              <Input 
                id="dashboard-name" 
                value={newDashboardName} 
                onChange={e => setNewDashboardName(e.target.value)} 
                placeholder={t('dashboard.namePlaceholder')}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleCreateDashboard();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dashboard-description">{t('dashboard.descriptionOptional')}</Label>
              <Input 
                id="dashboard-description" 
                value={newDashboardDescription} 
                onChange={e => setNewDashboardDescription(e.target.value)} 
                placeholder={t('dashboard.descriptionPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setCreateDashboardDialogOpen(false);
              setNewDashboardName("");
              setNewDashboardDescription("");
            }}>
              {t('dashboard.cancel')}
            </Button>
            <Button onClick={handleCreateDashboard} disabled={!newDashboardName.trim()}>
              {t('dashboard.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

      {/* Workspace type selector dialog */}
      <Dialog open={workspaceTypeDialogOpen} onOpenChange={setWorkspaceTypeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('workspace.chooseType') || 'Choose Workspace Type'}</DialogTitle>
            <DialogDescription>{t('workspace.chooseTypeDesc') || 'Select the type of workspace you want to create.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {WORKSPACE_TYPES.map((wt) => (
              <Card
                key={wt.id}
                className="p-4 cursor-pointer hover:shadow-md hover:border-blue-400 transition-all"
                onClick={() => handleCreateWorkspaceWithType(wt.id)}
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <wt.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{wt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{wt.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>;
};
export default Index;