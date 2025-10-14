import { useState, useEffect } from "react";
import { Plus, FileText } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (agentId) {
      loadSources();
    }
  }, [agentId]);

  async function loadSources() {
    if (!agentId) return;
    
    try {
      // Primeiro, buscar o agent para pegar os source_ids
      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('source_ids')
        .eq('id', agentId)
        .single();

      if (agentError) throw agentError;

      if (!agent || !agent.source_ids || agent.source_ids.length === 0) {
        setSources([]);
        setLoading(false);
        return;
      }

      // Buscar as fontes vinculadas ao agent
      const { data: sourcesData, error: sourcesError } = await supabase
        .from('sources')
        .select('*')
        .in('id', agent.source_ids);

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

  const filteredSources = sources.filter((source) =>
    source.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b space-y-3">
        <h2 className="font-semibold">Sources</h2>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onAddSource}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add
        </Button>
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
            {filteredSources.map((source) => (
              <div
                key={source.id}
                className="p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{source.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {source.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(source.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
