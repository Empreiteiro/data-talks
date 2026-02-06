import { AddSourceModal } from "@/components/AddSourceModal";
import { AgentSettingsModal } from "@/components/AgentSettingsModal";
import { SEO } from "@/components/SEO";
import { SourcesPanel } from "@/components/SourcesPanel";
import { StudioPanel } from "@/components/StudioPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { dataClient } from "@/services/supabaseClient";
import { ChevronRight, History, Layout, Lock, RotateCcw, Send, SlidersHorizontal, Table, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams, useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

// Componente para exibir gráficos com tratamento de erro robusto
const ChartImage = ({ imageUrl, qaSessionId, t }: { imageUrl: string; qaSessionId?: string; t: (key: string) => string }) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [addToDashboardOpen, setAddToDashboardOpen] = useState(false);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>("");

  const handleImageError = () => {
    console.error('Error loading chart image:', imageUrl?.substring(0, 100));
    setImageError(true);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    console.log('Chart image loaded successfully, dimensions:', img.naturalWidth, 'x', img.naturalHeight);
    setImageLoaded(true);
  };

  const loadDashboards = async () => {
    try {
      const data = await dataClient.listDashboards();
      setDashboards(data || []);
    } catch (error: any) {
      toast.error(t('dashboard.loadError'), {
        description: error.message
      });
    }
  };

  const handleAddToDashboard = async () => {
    if (!selectedDashboardId || !qaSessionId) return;
    
    try {
      await dataClient.addChartToDashboard(selectedDashboardId, qaSessionId);
      toast.success(t('dashboard.chartAddedSuccess'));
      setAddToDashboardOpen(false);
      setSelectedDashboardId("");
    } catch (error: any) {
      toast.error(t('dashboard.chartAddedError'), {
        description: error.message
      });
    }
  };

  const openAddToDashboard = () => {
    loadDashboards();
    setAddToDashboardOpen(true);
  };

  if (imageError) {
    return (
      <div className="mt-4 border rounded-lg p-4 bg-muted text-center">
        <p className="text-muted-foreground">⚠️ Erro ao carregar gráfico</p>
        <p className="text-xs text-muted-foreground mt-1">
          Verifique se a imagem foi gerada corretamente
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 border rounded-lg overflow-hidden bg-white relative group">
        {!imageLoaded && (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-sm text-muted-foreground mt-2">Carregando gráfico...</p>
          </div>
        )}
        <img 
          src={imageUrl} 
          alt="Gráfico gerado pelo BigQuery"
          className={`w-full h-auto block ${!imageLoaded ? 'hidden' : ''}`}
          style={{ 
            maxHeight: '600px', 
            objectFit: 'contain',
            backgroundColor: 'white'
          }}
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
        
        {/* Botão Add to Dashboard - aparece no hover */}
        {imageLoaded && qaSessionId && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              onClick={openAddToDashboard}
              className="bg-white/90 text-gray-900 hover:bg-white border border-gray-200 shadow-sm"
            >
              <Layout className="h-4 w-4 mr-2" />
              {t('dashboard.addToDashboard')}
            </Button>
          </div>
        )}
      </div>

      {/* Dialog para selecionar dashboard */}
      <Dialog open={addToDashboardOpen} onOpenChange={setAddToDashboardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.addToTitle')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.addToDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dashboard-select">{t('dashboard.title')}</Label>
              <Select value={selectedDashboardId} onValueChange={setSelectedDashboardId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('dashboard.selectDashboardPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {dashboards.map((dashboard) => (
                    <SelectItem key={dashboard.id} value={dashboard.id}>
                      {dashboard.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dashboards.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.noDashboardsFound')}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddToDashboardOpen(false)}>
              {t('dashboard.cancel')}
            </Button>
            <Button 
              onClick={handleAddToDashboard} 
              disabled={!selectedDashboardId}
            >
              {t('dashboard.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};


export default function Workspace() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAgentSettingsLocked = true;
  const stripFollowUpsFromAnswer = (answer: string, followUps?: string[]) => {
    if (!answer) return answer;
    if (!followUps || followUps.length === 0) return answer;
    const followUpSet = new Set(followUps.map((q) => q.trim()).filter(Boolean));
    if (followUpSet.size === 0) return answer;
    return answer
      .split("\n")
      .filter((line) => !followUpSet.has(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };
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
    imageUrl?: string;
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
  const [sourcesRefreshTrigger, setSourcesRefreshTrigger] = useState(0); // Trigger para atualizar SourcesPanel

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
      const sources = await dataClient.listSources(id);
      setHasSources(sources && sources.length > 0);
    } catch (error: any) {
      console.error("Erro ao verificar fontes:", error);
    }
  }

  async function loadAvailableColumns() {
    if (!id) return;
    try {
      const sources = await dataClient.listSources(id, true);
      const source = sources && sources[0];
      if (source) {
        const metadata = source?.metaJSON as any;
        let columnNames: string[] = [];
        if (source?.type === 'bigquery' && metadata?.table_infos && metadata.table_infos.length > 0) {
          // Pegar as colunas da primeira tabela
          columnNames = metadata.table_infos[0].columns || [];
          console.log('Workspace - BigQuery columns from table_infos:', columnNames);
        } 
        // Para Google Sheets, buscar de availableColumns
        else if (source.type === 'google_sheets' && metadata?.availableColumns) {
          columnNames = metadata.availableColumns;
        }
        else if (source.type === 'sql_database') {
          if (metadata?.availableColumns) {
            columnNames = metadata.availableColumns;
          } else if (metadata?.table_infos && metadata.table_infos.length > 0) {
            columnNames = metadata.table_infos[0].columns || [];
          }
        }
        else if (metadata?.columns) {
          columnNames = metadata.columns;
        }
        
        setAvailableColumns(columnNames);
      } else {
        setAvailableColumns([]);
      }
    } catch (error: any) {
      console.error("Erro ao carregar colunas:", error);
    }
  }

  async function loadWarmupQuestions() {
    if (!id) return;
    try {
      const agent = await dataClient.getAgent(id);
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
      const data = await dataClient.listQASessions(id);
      setHistory(data || []);
    } catch (error: any) {
      console.error("Erro ao carregar histórico:", error);
    }
  }

  const handleDeleteHistory = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dataClient.deleteQASession(sessionId);
      
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
    
    if (currentSessionId) {
      try {
        const conversationHistory = [];
        for (let i = 0; i < updatedMessages.length; i += 2) {
          if (updatedMessages[i]?.role === "user" && updatedMessages[i + 1]?.role === "assistant") {
            conversationHistory.push({
              question: updatedMessages[i].content,
              answer: updatedMessages[i + 1].content
            });
          }
        }
        await dataClient.updateQASession(currentSessionId, { conversation_history: conversationHistory });
        toast.success("Mensagem excluída");
      } catch (error: any) {
        console.error("Erro ao atualizar histórico:", error);
        toast.error("Erro ao excluir mensagem");
      }
    }
  };

  const handleLoadConversation = async (qaSession: any) => {
    const conversationHistory = qaSession.conversation_history || [];
    
    // Reconstruir o array de mensagens a partir do formato do backend
    const loadedMessages: Array<{role: string; content: string; imageUrl?: string}> = [];
    
    // Se conversation_history estiver vazio mas existir question e answer, usar esses valores
    if (conversationHistory.length === 0 && qaSession.question && qaSession.answer) {
      loadedMessages.push({
        role: "user",
        content: qaSession.question
      });
      
      // Verificar se há imageUrl no table_data para sessões antigas
      const imageUrl = qaSession.table_data?.image_url;
      
      loadedMessages.push({
        role: "assistant",
        content: stripFollowUpsFromAnswer(qaSession.answer, qaSession.follow_up_questions),
        imageUrl: imageUrl
      });
    } else {
      // Caso contrário, processar conversation_history normalmente
      conversationHistory.forEach((entry: any) => {
        // Adicionar pergunta do usuário
        loadedMessages.push({
          role: "user",
          content: entry.question
        });
        
        // Adicionar resposta do assistente com imageUrl se disponível
        loadedMessages.push({
          role: "assistant",
          content: stripFollowUpsFromAnswer(entry.answer, entry.followUpQuestions),
          imageUrl: entry.imageUrl
        });
      });
    }

    setMessages(loadedMessages);
    setCurrentSessionId(qaSession.id); // Manter o sessionId para continuar a conversa
    setIsHistoryOpen(false);
    
    if (qaSession.source_id && id) {
      try {
        const sources = await dataClient.listSources(id);
        for (const s of sources) {
          await dataClient.updateSource(s.id, { is_active: s.id === qaSession.source_id });
        }
        setSourcesRefreshTrigger(prev => prev + 1);
        loadAvailableColumns();
      } catch (error: any) {
        console.error("Erro ao ativar fonte da conversa:", error);
      }
    }
    
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
      // Validar que o usuário está autenticado
      if (!user?.id) {
        toast.error("Você precisa estar autenticado para fazer perguntas");
        setIsLoading(false);
        return;
      }

      const data = await dataClient.askQuestion(id, userMessage, currentSessionId || undefined);

      setMessages(prev => [...prev, {
        role: "assistant",
        content: stripFollowUpsFromAnswer(
          data.answer || "Não foi possível gerar uma resposta.",
          data.followUpQuestions
        ),
        imageUrl: data.imageUrl
      }]);
      
      if (data.followUpQuestions && Array.isArray(data.followUpQuestions)) {
        setFollowUpQuestions(data.followUpQuestions);
      } else {
        setFollowUpQuestions([]);
      }
      
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
            refreshTrigger={sourcesRefreshTrigger}
            onSourceActivated={loadAvailableColumns}
          />
        </div>

        {/* Chat Panel - Center */}
        <div className="flex-1 flex flex-col bg-card border rounded-xl overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between h-[57px]">
            <h1 className="font-semibold">{t('workspace.chat')}</h1>
            
            <div className="flex items-center gap-2">
              <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon">
                    <History className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                
              <Button 
                variant="outline" 
                size="icon"
                onClick={clearConversation}
                title={t('questions.clearConversation')}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => !isAgentSettingsLocked && setIsSettingsOpen(true)}
                title={isAgentSettingsLocked ? "Indisponível" : t('agentSettings.title')}
                disabled={isAgentSettingsLocked}
                className={isAgentSettingsLocked ? "opacity-50 cursor-not-allowed" : ""}
              >
                {isAgentSettingsLocked ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <SlidersHorizontal className="h-4 w-4" />
                )}
              </Button>
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
                {messages.map((message, index) => (
                  <div key={index} className="space-y-3">
                    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`group relative rounded-lg p-4 max-w-[80%] ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background border shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => handleDeleteMessage(index)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                    {message.imageUrl && (
                      <div className="flex justify-start">
                        <div className="max-w-[90%]">
                          <ChartImage 
                            imageUrl={message.imageUrl} 
                            qaSessionId={currentSessionId || undefined}
                            t={t}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-lg p-4 bg-muted">
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                        <p className="text-sm text-muted-foreground">{t('questions.processing')}</p>
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
                <Button onClick={handleSendMessage} disabled={!question.trim() || !hasSources || isLoading} className="h-12">
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

      <AddSourceModal open={addSourceOpen} onOpenChange={setAddSourceOpen} agentId={id} onSourceAdded={async (sourceId: string) => {
        if (!id) return;
        
        console.log('Source adicionada:', sourceId, 'para agent:', id);
        
        // A fonte já foi vinculada ao agent no bigquery-connect
        // Recarregar os dados
        setAddSourceOpen(false);
        setSourcesRefreshTrigger(prev => prev + 1);
        checkSources();
        loadAvailableColumns();
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