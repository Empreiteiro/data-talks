import { useState, useEffect } from "react";
import { Plus, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { dataClient } from "@/services/dataClient";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { DataPreviewModal } from "@/components/DataPreviewModal";

interface Source {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
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
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);

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
      const sourcesData = await dataClient.listSources();
      const mappedSources = (sourcesData || []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        createdAt: s.createdAt,
        metadata: s.metaJSON,
      }));
      setSources(mappedSources);
      setLoading(false);
    } catch (error) {
      console.error("Erro ao carregar sources:", error);
      toast.error("Erro ao carregar fontes de dados");
      setLoading(false);
    }
  }

  async function loadAgentSourceIds() {
    if (!agentId) return;
    try {
      setLoading(true);
      const sourcesData = await dataClient.listSources(agentId);
      const mappedSources = (sourcesData || []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        createdAt: s.createdAt,
        metadata: s.metaJSON,
        is_active: s.is_active,
        agent_id: s.agent_id,
      }));
      setActiveSourceIds(mappedSources.filter((source) => source.is_active).map((source) => source.id));
      setSources(mappedSources);
    } catch (error) {
      console.error("Erro ao carregar sources do agente:", error);
      toast.error("Erro ao carregar fontes");
    } finally {
      setLoading(false);
    }
  }


  async function handleToggleActive(sourceId: string) {
    if (!agentId) return;
    try {
      const existingSources = await dataClient.listSources(agentId);
      const targetSource = existingSources.find((source) => source.id === sourceId);
      if (!targetSource) return;

      const nextActive = !targetSource.is_active;
      await dataClient.updateSource(sourceId, { is_active: nextActive });
      toast.success(nextActive ? t("sources.sqlSourceActivated") : t("sources.sqlSourceDeactivated"));
      loadAgentSourceIds();
      if (onSourceActivated) onSourceActivated();
    } catch (error) {
      toast.error(t("sources.activateError"), { description: error.message });
    }
  }

  async function handleDeleteSource(sourceId: string) {
    try {
      await dataClient.deleteSource(sourceId);
      toast.success("Fonte removida com sucesso");
      if (agentId) {
        loadAgentSourceIds();
      } else {
        loadAllUserSources();
      }
    } catch (error) {
      toast.error("Erro ao remover fonte", { description: error.message });
    }
  }

  const filteredSources = sources.filter((source) =>
    source.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-background border rounded-lg">
      <div className="p-4 border-b flex items-center h-[57px]">
        <div className="flex items-center justify-between gap-2 w-full">
          <h2 className="font-semibold">{t('sources.title')}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddSource}
            disabled={false}
            data-walkthrough="ws-add-source"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('sources.add')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-4">
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
          <div className="space-y-3">
            {filteredSources.map((source) => {
              const isActive = !!(agentId && activeSourceIds.includes(source.id));
              
              return (
                <div
                  key={source.id}
                  className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${
                    ["unified_customers.csv", "enriched_customers.csv", "customer_segments.csv"].includes(source.name)
                      ? (isActive ? 'bg-yellow-400/15 border-yellow-400/30 hover:bg-yellow-400/20' : 'bg-yellow-400/5 border-yellow-400/20 hover:bg-yellow-400/10')
                      : (isActive ? 'bg-primary/15 border-primary/30 hover:bg-primary/20' : 'bg-muted/30 border-muted hover:bg-muted/50')
                  }`}
                  onClick={async () => {
                    if (agentId) {
                      handleToggleActive(source.id);
                    } else {
                      let previewMeta = source.metadata;
                      if (source.type === 'bigquery' && (!previewMeta?.table_infos || previewMeta.table_infos.length === 0)) {
                        try {
                          const res = await dataClient.refreshSourceBigQueryMetadata(source.id);
                          previewMeta = res?.metaJSON ?? previewMeta;
                        } catch (_) { /* intentional */ }
                        setPreviewSource({ ...source, metadata: previewMeta });
                      } else {
                        setPreviewSource(source);
                      }
                      setShowPreview(true);
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <FileText className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>
                        {source.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="text-xs flex-shrink-0">
                          {source.type}
                        </Badge>
                        {source.createdAt && (
                          <>
                            <span className="text-xs text-muted-foreground/60 flex-shrink-0" aria-hidden>·</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(source.createdAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
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
