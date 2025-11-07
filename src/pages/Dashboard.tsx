import { SEO } from "@/components/SEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { supabaseClient } from "@/services/supabaseClient";
import { ArrowLeft, Layout, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

interface DashboardData {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  dashboard_charts: DashboardChart[];
}

interface DashboardChart {
  id: string;
  dashboard_id: string;
  qa_session_id: string;
  image_url: string;
  title?: string;
  description?: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  created_at: string;
  qa_sessions: {
    id: string;
    question: string;
    answer: string;
    agent_id: string;
    created_at: string;
    agents: {
      id: string;
      name: string;
    };
  };
}

const Dashboard = () => {
  const { isAuthenticated, initializing } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectedChart, setSelectedChart] = useState<DashboardChart | null>(null);
  const [chartEditDialogOpen, setChartEditDialogOpen] = useState(false);
  const [chartTitle, setChartTitle] = useState("");
  const [chartDescription, setChartDescription] = useState("");

  useEffect(() => {
    if (!initializing && isAuthenticated && id) {
      loadDashboard();
    }
  }, [isAuthenticated, initializing, id]);

  async function loadDashboard() {
    if (!id) return;
    
    try {
      const data = await supabaseClient.getDashboard(id);
      setDashboard(data);
    } catch (error: any) {
      toast.error(t('dashboard.loadError'), {
        description: error.message
      });
      navigate('/');
    } finally {
      setLoading(false);
    }
  }

  const handleEditDashboard = () => {
    if (!dashboard) return;
    setEditName(dashboard.name);
    setEditDescription(dashboard.description || "");
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!dashboard || !editName.trim()) return;
    
    try {
      await supabaseClient.updateDashboard(
        dashboard.id,
        editName.trim(),
        editDescription.trim() || undefined
      );
      
      toast.success(t('dashboard.updateSuccess'));
      setEditDialogOpen(false);
      loadDashboard();
    } catch (error: any) {
      toast.error(t('dashboard.updateError'), {
        description: error.message
      });
    }
  };

  const handleDeleteDashboard = async () => {
    if (!dashboard) return;
    
    if (!confirm(t('dashboard.deleteConfirm', { name: dashboard.name }))) {
      return;
    }
    
    try {
      await supabaseClient.deleteDashboard(dashboard.id);
      toast.success(t('dashboard.deleteSuccess'));
      navigate('/');
    } catch (error: any) {
      toast.error(t('dashboard.deleteError'), {
        description: error.message
      });
    }
  };

  const handleEditChart = (chart: DashboardChart) => {
    setSelectedChart(chart);
    setChartTitle(chart.title || "");
    setChartDescription(chart.description || "");
    setChartEditDialogOpen(true);
  };

  const handleSaveChartEdit = async () => {
    if (!selectedChart) return;
    
    try {
      await supabaseClient.updateDashboardChart(selectedChart.id, {
        title: chartTitle.trim() || undefined,
        description: chartDescription.trim() || undefined
      });
      
      toast.success(t('dashboard.chartUpdateSuccess'));
      setChartEditDialogOpen(false);
      loadDashboard();
    } catch (error: any) {
      toast.error(t('dashboard.chartUpdateError'), {
        description: error.message
      });
    }
  };

  const handleRemoveChart = async (chartId: string) => {
    if (!confirm(t('dashboard.chartRemoveConfirm'))) {
      return;
    }
    
    try {
      await supabaseClient.removeChartFromDashboard(chartId);
      toast.success(t('dashboard.chartRemovedSuccess'));
      loadDashboard();
    } catch (error: any) {
      toast.error(t('dashboard.chartRemovedError'), {
        description: error.message
      });
    }
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
          <p className="text-muted-foreground">{t('dashboard.loading')}</p>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">{t('dashboard.notFound')}</h1>
          <p className="text-muted-foreground mb-4">{t('dashboard.notFoundDescription')}</p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('dashboard.backToHome')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title={`Dashboard: ${dashboard.name}`} 
        description={dashboard.description || t('dashboard.seoDescription')} 
      />
      
      <div className="w-full max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">{dashboard.name}</h1>
              {dashboard.description && (
                <p className="text-muted-foreground">{dashboard.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleEditDashboard}>
              <Pencil className="h-4 w-4 mr-2" />
              {t('dashboard.edit')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleEditDashboard}>
                  <Pencil className="h-4 w-4 mr-2" />
                  {t('dashboard.editDashboard')}
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-destructive" 
                  onClick={handleDeleteDashboard}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('dashboard.delete')} dashboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Charts Grid */}
        {dashboard.dashboard_charts.length === 0 ? (
          <Card className="p-12 text-center">
            <Layout className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t('dashboard.noCharts')}</h3>
            <p className="text-muted-foreground mb-4">
              {t('dashboard.noChartsDescription')}
            </p>
            <Button onClick={() => navigate('/')}>
              {t('dashboard.goToWorkspaces')}
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dashboard.dashboard_charts.map((chart) => (
              <Card key={chart.id} className="overflow-hidden">
                <div className="relative">
                  <img
                    src={chart.image_url}
                    alt={chart.title || t('dashboard.chart')}
                    className="w-full h-64 object-contain bg-gray-50"
                  />
                  <div className="absolute top-2 right-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="secondary" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditChart(chart)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t('dashboard.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={() => handleRemoveChart(chart.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('dashboard.remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                
                <div className="p-4">
                  <h3 className="font-semibold mb-2">
                    {chart.title || t('dashboard.untitledChart')}
                  </h3>
                  {chart.description && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {chart.description}
                    </p>
                  )}
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {chart.qa_sessions.agents.name}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      <strong>{t('dashboard.question')}:</strong> {chart.qa_sessions.question}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(chart.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dashboard Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.editDashboard')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.editDashboardDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t('dashboard.name')}</Label>
              <Input 
                id="edit-name" 
                value={editName} 
                onChange={e => setEditName(e.target.value)} 
                placeholder={t('dashboard.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">{t('dashboard.description')}</Label>
              <Textarea 
                id="edit-description" 
                value={editDescription} 
                onChange={e => setEditDescription(e.target.value)} 
                placeholder={t('dashboard.descriptionPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('dashboard.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>
              {t('dashboard.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Chart Dialog */}
      <Dialog open={chartEditDialogOpen} onOpenChange={setChartEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.editChart')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.editChartDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="chart-title">{t('dashboard.chartTitle')}</Label>
              <Input 
                id="chart-title" 
                value={chartTitle} 
                onChange={e => setChartTitle(e.target.value)} 
                placeholder={t('dashboard.chartTitlePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chart-description">{t('dashboard.chartDescription')}</Label>
              <Textarea 
                id="chart-description" 
                value={chartDescription} 
                onChange={e => setChartDescription(e.target.value)} 
                placeholder={t('dashboard.chartDescriptionPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChartEditDialogOpen(false)}>
              {t('dashboard.cancel')}
            </Button>
            <Button onClick={handleSaveChartEdit}>
              {t('dashboard.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
