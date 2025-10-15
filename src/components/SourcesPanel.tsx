import { useState, useEffect } from "react";
import { Plus, FileText, X, Link as LinkIcon, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface Source {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

interface SourcesPanelProps {
  onAddSource?: () => void;
  agentId?: string;
}

export function SourcesPanel({ onAddSource, agentId }: SourcesPanelProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<Source[]>([]);
  const [linkedSourceIds, setLinkedSourceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadSources();
    if (agentId) {
      loadAgentSourceIds();
    }
  }, [agentId]);

  async function loadAgentSourceIds() {
    if (!agentId) return;
    
    try {
      const { data: agent, error } = await supabase
        .from('agents')
        .select('source_ids')
        .eq('id', agentId)
        .single();

      if (error) throw error;
      setLinkedSourceIds(agent?.source_ids || []);
    } catch (error: any) {
      console.error("Erro ao carregar source_ids do agente:", error);
    }
  }

  async function loadSources() {
    try {
      // Buscar todas as fontes do usuário
      const { data: sourcesData, error: sourcesError } = await supabase
        .from('sources')
        .select('*')
        .order('created_at', { ascending: false });

      if (sourcesError) throw sourcesError;

      const mappedSources = (sourcesData || []).map(source => ({
        id: source.id,
        name: source.name,
        type: source.type,
        createdAt: source.created_at,
      }));
      setSources(mappedSources);
    } catch (error: any) {
      toast.error("Erro ao carregar fontes", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleSource(sourceId: string) {
    if (!agentId) return;
    
    try {
      const isLinked = linkedSourceIds.includes(sourceId);
      const updatedSourceIds = isLinked
        ? linkedSourceIds.filter(id => id !== sourceId)
        : [...linkedSourceIds, sourceId];

      const { error } = await supabase
        .from('agents')
        .update({ source_ids: updatedSourceIds })
        .eq('id', agentId);

      if (error) throw error;

      setLinkedSourceIds(updatedSourceIds);
      toast.success(isLinked ? "Fonte desvinculada" : "Fonte vinculada");
    } catch (error: any) {
      toast.error("Erro ao atualizar fonte", {
        description: error.message,
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

      // Se estava vinculada ao agente, também remover do agent
      if (agentId && linkedSourceIds.includes(sourceId)) {
        const updatedSourceIds = linkedSourceIds.filter(id => id !== sourceId);
        
        const { error: updateError } = await supabase
          .from('agents')
          .update({ source_ids: updatedSourceIds })
          .eq('id', agentId);

        if (updateError) throw updateError;
        setLinkedSourceIds(updatedSourceIds);
      }

      toast.success("Fonte removida com sucesso");
      loadSources();
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
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between w-full">
          <h2 className="font-semibold">{t('sources.title')}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddSource}
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
              const isLinked = linkedSourceIds.includes(source.id);
              return (
                <div
                  key={source.id}
                  className={`group relative p-3 rounded-lg border transition-colors ${
                    isLinked 
                      ? 'bg-primary/5 border-primary/20 hover:bg-primary/10' 
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isLinked ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{source.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant={isLinked ? "default" : "secondary"} className="text-xs">
                          {source.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(source.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {agentId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSource(source.id);
                          }}
                          title={isLinked ? "Desvincular fonte" : "Vincular fonte"}
                        >
                          {isLinked ? (
                            <Unlink className="h-4 w-4 text-orange-500" />
                          ) : (
                            <LinkIcon className="h-4 w-4 text-primary" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
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
    </div>
  );
}
