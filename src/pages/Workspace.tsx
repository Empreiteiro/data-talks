import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SourcesPanel } from "@/components/SourcesPanel";
import { StudioPanel } from "@/components/StudioPanel";
import { AddSourceModal } from "@/components/AddSourceModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Upload, ChevronRight } from "lucide-react";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
export default function Workspace() {
  const { t } = useLanguage();
  const {
    id
  } = useParams();
  const [searchParams] = useSearchParams();
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('openAddSource') === 'true') {
      setAddSourceOpen(true);
    }
  }, [searchParams]);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Array<{
    role: string;
    content: string;
  }>>([]);
  const [studioPanelCollapsed, setStudioPanelCollapsed] = useState(false);
  const [hasSources, setHasSources] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkSources();
  }, [id]);

  async function checkSources() {
    if (!id) return;
    
    try {
      const { data: agent, error } = await supabase
        .from('agents')
        .select('source_ids')
        .eq('id', id)
        .single();

      if (error) throw error;

      setHasSources(agent?.source_ids && agent.source_ids.length > 0);
    } catch (error: any) {
      console.error("Erro ao verificar fontes:", error);
    }
  }

  const handleSendMessage = async () => {
    if (!question.trim() || !id) return;
    
    const userMessage = question;
    setMessages([...messages, {
      role: "user",
      content: userMessage
    }]);
    setQuestion("");
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('ask-question', {
        body: {
          question: userMessage,
          agentId: id
        }
      });

      if (error) throw error;

      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.answer || "Não foi possível gerar uma resposta."
      }]);
    } catch (error: any) {
      console.error("Erro ao enviar pergunta:", error);
      toast.error("Erro ao processar pergunta", {
        description: error.message
      });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Desculpe, ocorreu um erro ao processar sua pergunta."
      }]);
    } finally {
      setIsLoading(false);
    }
  };
  return <div className="h-[calc(100vh-4rem)] flex flex-col bg-background p-4">
      <SEO title="Workspace" description="Converse com seus dados" canonical={`/workspace/${id}`} />
      
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Sources Panel - Left */}
        <div className="w-80 flex-shrink-0 bg-card border rounded-xl overflow-hidden flex flex-col">
          <SourcesPanel 
            agentId={id} 
            onAddSource={() => setAddSourceOpen(true)} 
          />
        </div>

        {/* Chat Panel - Center */}
        <div className="flex-1 flex flex-col bg-card border rounded-xl overflow-hidden">
          <div className="p-4 border-b flex items-center h-[57px]">
            <h1 className="font-semibold">{t('workspace.chat')}</h1>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {messages.length === 0 ? <div className="flex flex-col items-center justify-center h-full text-center">
                <Upload className="h-16 w-16 text-primary mb-4" />
                <h2 className="text-xl font-semibold mb-2">
                  {hasSources ? t('workspace.startConversation') : t('workspace.addSourceToStart')}
                </h2>
                <p className="text-muted-foreground max-w-md mb-6">
                  {hasSources 
                    ? t('workspace.startConversationDescription')
                    : t('workspace.addSourceDescription')
                  }
                </p>
                {!hasSources && (
                  <Button onClick={() => setAddSourceOpen(true)}>
                    {t('workspace.uploadSource')}
                  </Button>
                )}
              </div> : <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((message, index) => <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`rounded-lg p-4 max-w-[80%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>)}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-lg p-4 bg-muted">
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                        <p className="text-sm text-muted-foreground">Processando...</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>}
          </div>

          <div className="p-4 border-t">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-2">
                <Input value={question} onChange={e => setQuestion(e.target.value)} placeholder={hasSources ? t('workspace.inputPlaceholder') : t('workspace.addSourceFirst')} onKeyPress={e => e.key === "Enter" && !isLoading && hasSources && handleSendMessage()} disabled={!hasSources || isLoading} />
                <Button onClick={handleSendMessage} disabled={!question.trim() || !hasSources || isLoading}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              
            </div>
          </div>
        </div>

        {/* Studio Panel - Right */}
        {!studioPanelCollapsed && <div className="w-80 flex-shrink-0 bg-card border rounded-xl overflow-hidden flex flex-col">
            <StudioPanel collapsed={studioPanelCollapsed} onToggleCollapse={() => setStudioPanelCollapsed(!studioPanelCollapsed)} />
          </div>}

        {/* Collapsed Studio Panel Button */}
        {studioPanelCollapsed && <div className="flex-shrink-0 flex items-center">
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" onClick={() => setStudioPanelCollapsed(false)}>
              <ChevronRight className="h-4 w-4 rotate-180" />
            </Button>
          </div>}
      </div>

      <AddSourceModal open={addSourceOpen} onOpenChange={setAddSourceOpen} onSourceAdded={async (sourceId: string) => {
        if (!id) return;
        
        // Auto-vincular a fonte ao workspace (substituindo qualquer fonte anterior)
        try {
          const { error } = await supabase
            .from('agents')
            .update({ source_ids: [sourceId] })
            .eq('id', id);

          if (error) throw error;
          
          checkSources();
          window.location.reload();
        } catch (error: any) {
          console.error("Erro ao vincular fonte:", error);
          toast.error("Erro ao vincular fonte", {
            description: error.message
          });
        }
      }} />
    </div>;
}