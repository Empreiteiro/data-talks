import { useState, useEffect } from "react";
import { Plus, Search, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabaseClient } from "@/services/supabaseClient";
import { toast } from "sonner";

interface Source {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

interface SourcesPanelProps {
  onAddSource?: () => void;
}

export function SourcesPanel({ onAddSource }: SourcesPanelProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    try {
      const data = await supabaseClient.listSources();
      const mappedSources = (data || []).map(source => ({
        id: source.id,
        name: source.name,
        type: source.type,
        createdAt: source.createdAt,
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onAddSource}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
          <Button variant="outline" size="sm" className="flex-1">
            <Search className="h-4 w-4 mr-2" />
            Discover
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
              As fontes salvas aparecerão aqui
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Clique em Add acima para adicionar PDFs, websites, texto, vídeos ou arquivos de áudio. 
              Ou importe um arquivo diretamente do Google Drive.
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
