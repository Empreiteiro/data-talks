import { useState, useEffect } from "react";
import { Plus, FileText, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { DataPreviewModal } from "@/components/DataPreviewModal";

interface Source {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  metadata?: any;
  is_active?: boolean;
  agent_id?: string;
}

interface SourcesPanelProps {
  onAddSource?: () => void;
  agentId?: string;
  refreshTrigger?: number; // Novo: trigger para forçar refresh
  onSourceActivated?: () => void; // Callback quando uma fonte é ativada
}

export function SourcesPanel({ onAddSource, agentId, refreshTrigger, onSourceActivated }: SourcesPanelProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Source[]>([]);
  const [linkedSourceIds, setLinkedSourceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (agentId) {
      loadAgentSourceIds();
    } else {
      loadAllUserSources();
    }
  }, [agentId, refreshTrigger]); // Adicionar refreshTrigger como dependência

  // Recarregar sources quando a janela recebe foco
  useEffect(() => {
    const handleFocus = () => {
      if (agentId) {
        loadAgentSourceIds();
      } else {
        loadAllUserSources();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [agentId]);

  async function loadAllUserSources() {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: sourcesData, error: sourcesError } = await supabase
        .from('sources')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (sourcesError) throw sourcesError;

      const mappedSources = (sourcesData || []).map(source => ({
        id: source.id,
        name: source.name,
        type: source.type,
        createdAt: source.created_at,
        metadata: source.metadata,
      }));
      
      setSources(mappedSources);
      setLoading(false);
    } catch (error: any) {
      console.error("Erro ao carregar sources:", error);
      toast.error("Erro ao carregar fontes de dados");
      setLoading(false);
    }
  }

  async function loadAgentSourceIds() {
    if (!agentId) return;
    
    try {
      // Carregar todas as fontes do agent
      const { data: sourcesData, error: sourcesError } = await supabase
        .from('sources')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (sourcesError) throw sourcesError;

      const mappedSources = (sourcesData || []).map(source => ({
        id: source.id,
        name: source.name,
        type: source.type,
        createdAt: source.created_at,
        metadata: source.metadata,
        is_active: source.is_active,
        agent_id: source.agent_id,
      }));
      
      // Identificar fonte ativa
      const activeSource = mappedSources.find(s => s.is_active);
      setActiveSourceId(activeSource?.id || null);
      
      setSources(mappedSources);
      setLoading(false);
    } catch (error: any) {
      console.error("Erro ao carregar sources do agente:", error);
      setLoading(false);
    }
  }


  async function handleToggleActive(sourceId: string) {
    if (!agentId) return;
    
    try {
      // Desativar todas as fontes do agent
      await supabase
        .from('sources')
        .update({ is_active: false })
        .eq('agent_id', agentId);
      
      // Ativar a fonte selecionada
      const { error } = await supabase
        .from('sources')
        .update({ is_active: true })
        .eq('id', sourceId);
        
      if (error) throw error;
      
      setActiveSourceId(sourceId);
      toast.success("Fonte ativada com sucesso");
      
      // Recarregar as sources
      loadAgentSourceIds();
      
      // Notificar o Workspace para recarregar os available columns
      if (onSourceActivated) {
        onSourceActivated();
      }
    } catch (error: any) {
      toast.error("Erro ao ativar fonte", {
        description: error.message
      });
    }
  }

  async function handleDeleteSource(sourceId: string) {
    try {
      // Remover a fonte da tabela sources
      const { error: deleteError } = await supabase
        .from('sources')
        .delete()
        .eq('id', sourceId);

      if (deleteError) throw deleteError;

      toast.success("Fonte removida com sucesso");
      
      // Recarregar as sources
      if (agentId) {
        loadAgentSourceIds();
      } else {
        loadAllUserSources();
      }
    } catch (error: any) {
      toast.error("Erro ao remover fonte", {
        description: error.message,
      });
    }
  }

  const filteredSources = sources.filter((source) =>
    source.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t('sources.title')}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddSource}
            disabled={false}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('sources.add')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Carregando...</p>
            </div>
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FileText className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {t('sources.savedSourcesAppear')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('sources.addSourcesInstructions')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSources.map((source) => {
              const isActive = agentId && source.id === activeSourceId;
              
              return (
                <div
                  key={source.id}
                  className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${
                    isActive 
                      ? 'bg-primary/15 border-primary/30 hover:bg-primary/20' 
                      : 'bg-muted/30 border-muted hover:bg-muted/50'
                  }`}
                  onClick={() => {
                    if (agentId && !isActive) {
                      handleToggleActive(source.id);
                    } else if (!agentId) {
                      setPreviewSource(source);
                      setShowPreview(true);
                    }
                  }}
                >
                  <div className="flex items-start gap-2">
                    <FileText className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>
                        {source.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {source.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(source.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSource(source.id);
                        }}
                        title="Excluir fonte"
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {previewSource && (
        <DataPreviewModal
          open={showPreview}
          onOpenChange={setShowPreview}
          sourceName={previewSource.name}
          metadata={previewSource.metadata}
        />
      )}
    </div>
  );
}
