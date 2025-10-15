import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SourcesPanel } from "@/components/SourcesPanel";
import { StudioPanel } from "@/components/StudioPanel";
import { AddSourceModal } from "@/components/AddSourceModal";
import { AgentSettingsModal } from "@/components/AgentSettingsModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Upload, ChevronRight, History, X, Table, SlidersHorizontal, RotateCcw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
export default function Workspace() {
  const { t } = useLanguage();
  const { user } = useAuth();
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
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [studioPanelCollapsed, setStudioPanelCollapsed] = useState(() => {
    const saved = localStorage.getItem('studioPanelCollapsed');
    return saved === 'true';
  });
  const [hasSources, setHasSources] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [warmupQuestions, setWarmupQuestions] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    checkSources();
    loadHistory();
    loadAvailableColumns();
    loadWarmupQuestions();
  }, [id, user]);

  useEffect(() => {
    localStorage.setItem('studioPanelCollapsed', studioPanelCollapsed.toString());
  }, [studioPanelCollapsed]);

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

  async function loadAvailableColumns() {
    if (!id) return;
    
    try {
      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('source_ids')
        .eq('id', id)
        .single();

      if (agentError) throw agentError;

      if (agent?.source_ids && agent.source_ids.length > 0) {
        const { data: source, error: sourceError } = await supabase
          .from('sources')
          .select('metadata')
          .eq('id', agent.source_ids[0])
          .single();

        if (sourceError) throw sourceError;

        const metadata = source?.metadata as any;
        console.log('Workspace - source metadata:', metadata);
        
        const columnNames = metadata?.columns || [];
        console.log('Workspace - columnNames:', columnNames);
        
        setAvailableColumns(columnNames);
      }
    } catch (error: any) {
      console.error("Erro ao carregar colunas:", error);
    }
  }

  async function loadWarmupQuestions() {
    if (!id) return;
    
    try {
      const { data: agent, error } = await supabase
        .from('agents')
        .select('suggested_questions')
        .eq('id', id)
        .single();

      if (error) throw error;

      setWarmupQuestions(agent?.suggested_questions || []);
    } catch (error: any) {
      console.error("Erro ao carregar perguntas de aquecimento:", error);
    }
  }

  function clearConversation() {
    setMessages([]);
    setCurrentSessionId(null);
    setFollowUpQuestions([]);
    setQuestion("");
  }

  async function loadHistory() {
    if (!id || !user) return;
    
    try {
      const { data, error } = await supabase
        .from('qa_sessions')
        .select('*')
        .eq('agent_id', id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setHistory(data || []);
    } catch (error: any) {
      console.error("Erro ao carregar histórico:", error);
    }
  }

  const handleDeleteHistory = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Evitar que o card seja clicado
    
    try {
      const { error } = await supabase
        .from('qa_sessions')
        .delete()
        .eq('id', sessionId);
        
      if (error) throw error;
      
      // Se a conversa excluída é a atual, limpar o chat
      if (currentSessionId === sessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
      
      // Recarregar histórico
      loadHistory();
      toast.success("Conversa excluída");
    } catch (error: any) {
      console.error("Erro ao excluir conversa:", error);
      toast.error("Erro ao excluir conversa");
    }
  };

  const handleDeleteMessage = async (index: number) => {
    const updatedMessages = messages.filter((_, i) => i !== index);
    setMessages(updatedMessages);
    
    // Se temos um sessionId, atualizar no backend
    if (currentSessionId) {
      try {
        // Reconstruir conversation_history a partir das mensagens atualizadas
        const conversationHistory = [];
        for (let i = 0; i < updatedMessages.length; i += 2) {
          if (updatedMessages[i]?.role === "user" && updatedMessages[i + 1]?.role === "assistant") {
            conversationHistory.push({
              question: updatedMessages[i].content,
              answer: updatedMessages[i + 1].content
            });
          }
        }
        
        const { error } = await supabase
          .from('qa_sessions')
          .update({ conversation_history: conversationHistory })
          .eq('id', currentSessionId);
          
        if (error) throw error;
        
        toast.success("Mensagem excluída");
      } catch (error: any) {
        console.error("Erro ao atualizar histórico:", error);
        toast.error("Erro ao excluir mensagem");
      }
    }
  };

  const handleLoadConversation = (qaSession: any) => {
    const conversationHistory = qaSession.conversation_history || [];
    
    // Reconstruir o array de mensagens a partir do formato do backend
    const loadedMessages: Array<{role: string; content: string}> = [];
    
    conversationHistory.forEach((entry: any) => {
      // Adicionar pergunta do usuário
      loadedMessages.push({
        role: "user",
        content: entry.question
      });
      
      // Adicionar resposta do assistente
      loadedMessages.push({
        role: "assistant",
        content: entry.answer
      });
    });

    setMessages(loadedMessages);
    setCurrentSessionId(qaSession.id); // Manter o sessionId para continuar a conversa
    setIsHistoryOpen(false);
    
    toast.success("Conversa carregada", {
      description: "Você pode continuar de onde parou.",
    });
  };

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
          agentId: id,
          userId: user?.id,
          sessionId: currentSessionId // Enviar sessionId se existir para continuar conversa
        }
      });

      if (error) throw error;

      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.answer || "Não foi possível gerar uma resposta."
      }]);
      
      // Atualizar follow-up questions se disponíveis
      console.log('Follow-up questions from API:', data.followUpQuestions);
      if (data.followUpQuestions && Array.isArray(data.followUpQuestions)) {
        console.log('Setting follow-up questions:', data.followUpQuestions);
        setFollowUpQuestions(data.followUpQuestions);
      } else {
        console.log('No follow-up questions or invalid format');
        setFollowUpQuestions([]);
      }
      
      // Atualizar sessionId se for uma nova conversa
      if (data.sessionId && !currentSessionId) {
        setCurrentSessionId(data.sessionId);
      }
      
      // Recarregar histórico após resposta bem-sucedida
      loadHistory();
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
          <div className="p-4 border-b flex items-center justify-between h-[57px]">
            <h1 className="font-semibold">{t('workspace.chat')}</h1>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setIsSettingsOpen(true)}
                title={t('agentSettings.title')}
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              
              <Button 
                variant="outline" 
                size="icon"
                onClick={clearConversation}
                title={t('questions.clearConversation')}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              
              <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon">
                    <History className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
              <SheetContent className="w-[400px] sm:w-[540px]">
                <SheetHeader>
                  <SheetTitle>{t('workspace.previousConversations')}</SheetTitle>
                  <SheetDescription>
                    {t('workspace.previousConversationsDescription')}
                  </SheetDescription>
                </SheetHeader>
                <ScrollArea className="h-[calc(100vh-120px)] mt-6">
                  {history.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      {t('workspace.noPreviousConversations')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {history.map((qaSession: any) => (
                        <Card
                          key={qaSession.id}
                          className="group relative cursor-pointer hover:bg-accent transition-colors"
                          onClick={() => handleLoadConversation(qaSession)}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background border shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
                            onClick={(e) => handleDeleteHistory(qaSession.id, e)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <CardHeader className="p-4">
                            <CardTitle className="text-sm line-clamp-1 pr-8">
                              {qaSession.question}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {new Date(qaSession.created_at).toLocaleString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </CardDescription>
                          </CardHeader>
                          {qaSession.answer && (
                            <CardContent className="p-4 pt-0">
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {qaSession.answer}
                              </p>
                            </CardContent>
                          )}
                        </Card>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </SheetContent>
            </Sheet>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6">
            {availableColumns.length > 0 && messages.length === 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Table className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">{t('questions.availableColumns')}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableColumns.map((column, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      className="text-xs h-auto py-1.5 px-3 font-mono"
                      onClick={() => setQuestion(prev => prev ? `${prev} ${column}` : column)}
                    >
                      {column}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Perguntas de Aquecimento */}
            {warmupQuestions.length > 0 && messages.length === 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium">{t('questions.warmupQuestions')}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {warmupQuestions.map((question, idx) => (
                    <Button
                      key={idx}
                      variant="secondary"
                      size="sm"
                      className="text-xs h-auto py-2 px-3"
                      onClick={() => setQuestion(question)}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            
            {messages.length === 0 ? <div className="flex flex-col items-center justify-center h-full text-center">
                {!hasSources && <Upload className="h-16 w-16 text-primary mb-4" />}
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
                    <div className={`group relative rounded-lg p-4 max-w-[80%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background border shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => handleDeleteMessage(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
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
              {followUpQuestions.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {followUpQuestions.map((fq, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      className="text-xs h-auto py-2 px-3"
                      onClick={() => setQuestion(fq)}
                    >
                      {fq}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input value={question} onChange={e => setQuestion(e.target.value)} placeholder={hasSources ? t('workspace.inputPlaceholder') : t('workspace.addSourceFirst')} onKeyPress={e => e.key === "Enter" && !isLoading && hasSources && handleSendMessage()} disabled={!hasSources || isLoading} className="h-12" />
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
          loadAvailableColumns();
          window.location.reload();
        } catch (error: any) {
          console.error("Erro ao vincular fonte:", error);
          toast.error("Erro ao vincular fonte", {
            description: error.message
          });
        }
      }} />
      
      <AgentSettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        agentId={id || ''}
        onSettingsUpdated={() => {
          loadWarmupQuestions();
          toast.success("Configurações atualizadas");
        }}
      />
    </div>;
}