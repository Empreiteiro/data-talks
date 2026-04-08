import { AddSourceModal } from "@/components/AddSourceModal";
import { AgentSettingsModal } from "@/components/AgentSettingsModal";
import { AudioOverviewModal } from "@/components/AudioOverviewModal";
import { ChartRenderer, ChartSpec } from "@/components/ChartRenderer";
import { GraphViewModal } from "@/components/GraphViewModal";
import { LogsModal } from "@/components/LogsModal";
import { ProtectedImage } from "@/components/ProtectedImage";
import { SEO } from "@/components/SEO";
import { SqlRelationshipsModal } from "@/components/SqlRelationshipsModal";
import { SourcesPanel } from "@/components/SourcesPanel";
import { StudioPanel } from "@/components/StudioPanel";
import { SummaryModal } from "@/components/SummaryModal";
import { MessagingModal } from "@/components/MessagingModal";
import { ApiAccessModal } from "@/components/ApiAccessModal";
import { AutoMLModal } from "@/components/AutoMLModal";
import { MedallionPanel } from "@/components/MedallionPanel";
import { ReportModal } from "@/components/ReportModal";
import { TemplateModal } from "@/components/TemplateModal";
import { AlertModal } from "@/components/AlertModal";
import { CdpWizardModal } from "@/components/CdpWizardModal";
import { EtlPipelineModal } from "@/components/EtlPipelineModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageWalkthrough } from "@/contexts/WalkthroughContext";
import { workspaceSteps } from "@/components/walkthrough/steps/workspaceSteps";
import { useAuth } from "@/hooks/useAuth";
import { dataClient } from "@/services/dataClient";
import { BarChart3, Bot, ChevronRight, History, Layout, Link2, RotateCcw, Send, Table, Terminal, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams, useSearchParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

// Componente para exibir gráficos com tratamento de erro robusto
const ChartImage = ({ imageUrl, qaSessionId, t, onRemoveImage }: { imageUrl: string; qaSessionId?: string; t: (key: string) => string; onRemoveImage?: () => void }) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [dashboards, setDashboards] = useState<Array<{ id: string; name: string }>>([]);
  const [addToDashboardOpen, setAddToDashboardOpen] = useState(false);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>("");

  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [imageUrl]);

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
    } catch (error) {
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
    } catch (error) {
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
      <div className="mt-4 border rounded-lg overflow-hidden bg-card relative group">
        <ProtectedImage
          src={imageUrl}
          alt="Chart generated by the agent"
          className={`w-full h-auto block ${!imageLoaded ? 'hidden' : ''}`}
          style={{
            maxHeight: '600px',
            objectFit: 'contain',
            backgroundColor: 'transparent'
          }}
          onError={handleImageError}
          onLoad={handleImageLoad}
          loadingFallback={
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-sm text-muted-foreground mt-2">Carregando gráfico...</p>
            </div>
          }
          errorFallback={null}
        />
        
        {/* Botões no hover: Remover imagem e Add to Dashboard */}
        {imageLoaded && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            {onRemoveImage && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onRemoveImage}
                className="h-6 w-6"
                title={t('workspace.removeImage') || 'Remover imagem'}
              >
                <X className="h-4 w-4 text-destructive" />
              </Button>
            )}
            {qaSessionId && (
              <Button
                size="sm"
                onClick={openAddToDashboard}
                className="bg-white/90 text-gray-900 hover:bg-white border border-gray-200 shadow-sm"
              >
                <Layout className="h-4 w-4 mr-2" />
                {t('dashboard.addToDashboard')}
              </Button>
            )}
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

type ChatMessage = {
  role: string;
  content: string;
  imageUrl?: string;
  turnId?: string;
  followUpQuestions?: string[];
  chartInput?: unknown;
  chartSpec?: ChartSpec | unknown;
  chartScript?: string;
  isChartLoading?: boolean;
};


interface QASessionRecord {
  id: string;
  question?: string;
  answer?: string;
  created_at?: string;
  conversationHistory?: Record<string, unknown>[];
  conversation_history?: Record<string, unknown>[];
  follow_up_questions?: string[];
  imageUrl?: string;
  table_data?: { image_url?: string };
  source_id?: string;
}

export default function Workspace() {
  const { t } = useLanguage();
  const { user } = useAuth();
  usePageWalkthrough('workspace', workspaceSteps);
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
  type QuestionSegment = { type: "text"; value: string } | { type: "column"; name: string };
  const [questionSegments, setQuestionSegments] = useState<QuestionSegment[]>([]);
  const [questionInput, setQuestionInput] = useState("");
  const getQuestionFullText = () =>
    questionSegments.map((s) => (s.type === "text" ? s.value : s.name)).join("") + questionInput;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [studioPanelCollapsed, setStudioPanelCollapsed] = useState(() => {
    const saved = localStorage.getItem('studioPanelCollapsed');
    return saved === 'true';
  });
  const [hasSources, setHasSources] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [hasEnvLlm, setHasEnvLlm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<QASessionRecord[]>([]);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [warmupQuestions, setWarmupQuestions] = useState<string[]>([]);
  const [workspaceType, setWorkspaceType] = useState("analysis");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMessagingModalOpen, setIsMessagingModalOpen] = useState(false);
  const [isApiAccessModalOpen, setIsApiAccessModalOpen] = useState(false);
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [audioOverviewModalOpen, setAudioOverviewModalOpen] = useState(false);
  const [autoMLModalOpen, setAutoMLModalOpen] = useState(false);
  const [medallionOpen, setMedallionOpen] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [cdpWizardOpen, setCdpWizardOpen] = useState(false);
  const [etlPipelineOpen, setEtlPipelineOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [sourcesRefreshTrigger, setSourcesRefreshTrigger] = useState(0); // Trigger para atualizar SourcesPanel
  const [sqlRelationshipsOpen, setSqlRelationshipsOpen] = useState(false);
  const [sqlSourcesCount, setSqlSourcesCount] = useState(0);

  useEffect(() => {
    checkSources();
    loadHistory();
    loadAvailableColumns();
    loadWarmupQuestions();
    loadSqlSourcesCount();
    checkLlmStatus();
  }, [id, user]);

  useEffect(() => {
    localStorage.setItem('studioPanelCollapsed', studioPanelCollapsed.toString());
  }, [studioPanelCollapsed]);

  async function checkSources() {
    if (!id) return;
    try {
      const sources = await dataClient.listSources(id);
      setHasSources(sources && sources.length > 0);
    } catch (error) {
      console.error("Erro ao verificar fontes:", error);
    }
  }

  async function checkLlmStatus() {
    try {
      const status = await dataClient.getLlmStatus();
      setLlmConfigured(status.configured);
      setHasEnvLlm(status.has_env);
    } catch (error) {
      console.error("Erro ao verificar status LLM:", error);
      setLlmConfigured(false);
      setHasEnvLlm(false);
    }
  }

  async function loadSqlSourcesCount() {
    if (!id) return;
    try {
      const sources = await dataClient.listSources(id);
      setSqlSourcesCount((sources || []).filter((source) => source.type === "sql_database").length);
    } catch (error) {
      console.error("Erro ao carregar contagem de fontes SQL:", error);
    }
  }

  function getColumnsFromSource(source: { name: string; type: string; metaJSON?: Record<string, unknown> }, withPrefix: boolean): string[] {
    const meta = source?.metaJSON || {};
    const prefix = withPrefix ? source.name + "." : "";

    if (source.type === "sql_database") {
      const tableInfos = meta.table_infos || [];
      if (tableInfos.length > 0) {
        return tableInfos.flatMap((ti: { table: string; columns?: string[] }) =>
          (ti.columns || []).map((col: string) => `${ti.table}.${col}`)
        );
      }
      return (meta.availableColumns || []).map((c: string) => prefix + c);
    }
    if (source.type === "bigquery") {
      const tables = meta.table_infos || meta.tables || [];
      return tables.flatMap((ti: { table?: string; columns?: string[] }) =>
        (ti.columns || []).map((c: string) => prefix + c)
      );
    }
    if (source.type === "google_sheets") {
      return (meta.availableColumns || meta.available_columns || []).map((c: string) => prefix + c);
    }
    if (meta.columns) {
      return meta.columns.map((c: string) => prefix + c);
    }
    return [];
  }

  async function loadAvailableColumns() {
    if (!id) return;
    try {
      let sources = await dataClient.listSources(id, true);
      sources = sources || [];

      if (sources.length > 1) {
        const allColumns = sources.flatMap((s) => getColumnsFromSource(s, true));
        setAvailableColumns(Array.from(new Set(allColumns)));
        return;
      }

      const source = sources[0];
      if (source) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let metadata = source?.metaJSON as any;
        let columnNames: string[] = [];
        if (source?.type === "bigquery") {
          const hasTableInfos = metadata?.table_infos && metadata.table_infos.length > 0;
          if (!hasTableInfos && source.id) {
            try {
              const refreshed = await dataClient.refreshSourceBigQueryMetadata(source.id);
              metadata = refreshed?.metaJSON ?? metadata;
              sources = await dataClient.listSources(id, true);
              const updated = sources?.[0];
              if (updated?.metaJSON?.table_infos?.length) {
                columnNames = updated.metaJSON.table_infos[0].columns || [];
              }
            } catch (_) {
              columnNames = metadata?.table_infos?.[0]?.columns || [];
            }
          } else {
            columnNames = metadata?.table_infos?.[0]?.columns || [];
          }
        } else if (source.type === "google_sheets" && metadata?.availableColumns) {
          columnNames = metadata.availableColumns;
        } else if (source.type === "sql_database") {
          if (metadata?.availableColumns) columnNames = metadata.availableColumns;
          else if (metadata?.table_infos?.length) columnNames = metadata.table_infos[0].columns || [];
        } else if (metadata?.columns) {
          columnNames = metadata.columns;
        }
        setAvailableColumns(columnNames);
      } else {
        setAvailableColumns([]);
      }
    } catch (error) {
      console.error("Erro ao carregar colunas:", error);
    }
  }

  async function loadWarmupQuestions() {
    if (!id) return;
    try {
      const agent = await dataClient.getAgent(id);
      setWarmupQuestions(agent?.suggested_questions || []);
      setWorkspaceType(agent?.workspace_type || "analysis");
    } catch (error) {
      console.error("Erro ao carregar perguntas de aquecimento:", error);
    }
  }

  function clearConversation() {
    setMessages([]);
    setCurrentSessionId(null);
    setFollowUpQuestions([]);
    setQuestionSegments([]);
    setQuestionInput("");
  }

  function handleSourceContextChanged() {
    clearConversation();
    loadAvailableColumns();
    loadSqlSourcesCount();
  }

  async function loadHistory() {
    if (!id || !user) return;
    try {
      const data = await dataClient.listQASessions(id);
      setHistory(data || []);
    } catch (error) {
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
    } catch (error) {
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
              id: updatedMessages[i + 1].turnId,
              question: updatedMessages[i].content,
              answer: updatedMessages[i + 1].content,
              imageUrl: updatedMessages[i + 1].imageUrl,
              followUpQuestions: updatedMessages[i + 1].followUpQuestions || [],
              chartInput: updatedMessages[i + 1].chartInput,
              chartSpec: updatedMessages[i + 1].chartSpec,
              chartScript: updatedMessages[i + 1].chartScript,
            });
          }
        }
        await dataClient.updateQASession(currentSessionId, { conversation_history: conversationHistory });
        toast.success("Mensagem excluída");
      } catch (error) {
        console.error("Erro ao atualizar histórico:", error);
        toast.error("Erro ao excluir mensagem");
      }
    }
  };

  const handleRemoveImageFromMessage = async (messageIndex: number) => {
    const message = messages[messageIndex];
    if (!message?.imageUrl && !message?.chartSpec) return;
    setMessages((prev) => prev.map((item, idx) =>
      idx === messageIndex
        ? { ...item, imageUrl: undefined, chartSpec: undefined, chartScript: undefined, chartInput: undefined }
        : item
    ));
    if (currentSessionId) {
      try {
        const conversationHistory: Record<string, unknown>[] = [];
        const updatedMessages = messages.map((item, idx) =>
          idx === messageIndex ? { ...item, imageUrl: undefined, chartSpec: undefined, chartScript: undefined, chartInput: undefined } : item
        );
        for (let i = 0; i < updatedMessages.length; i += 2) {
          if (updatedMessages[i]?.role === "user" && updatedMessages[i + 1]?.role === "assistant") {
            conversationHistory.push({
              id: updatedMessages[i + 1].turnId,
              question: updatedMessages[i].content,
              answer: updatedMessages[i + 1].content,
              imageUrl: updatedMessages[i + 1].imageUrl,
              followUpQuestions: updatedMessages[i + 1].followUpQuestions || [],
              chartInput: updatedMessages[i + 1].chartInput,
              chartSpec: updatedMessages[i + 1].chartSpec,
              chartScript: updatedMessages[i + 1].chartScript,
            });
          }
        }
        await dataClient.updateQASession(currentSessionId, { conversation_history: conversationHistory });
        toast.success(t('workspace.imageRemoved') || "Imagem removida da conversa");
      } catch (error) {
        console.error("Erro ao remover imagem:", error);
        toast.error(t('workspace.imageRemoveError') || "Erro ao remover imagem");
      }
    }
  };

  const handleGenerateChart = async (messageIndex: number) => {
    const message = messages[messageIndex];
    if (!currentSessionId || !message || message.role !== "assistant") return;

    setMessages((prev) => prev.map((item, idx) => (
      idx === messageIndex ? { ...item, isChartLoading: true } : item
    )));

    try {
      const data = await dataClient.generateChartForTurn(currentSessionId, {
        turnId: message.turnId,
      });
      setMessages((prev) => prev.map((item, idx) => (
        idx === messageIndex
          ? {
              ...item,
              chartSpec: data.chartSpec ?? item.chartSpec,
              turnId: data.turnId ?? item.turnId,
              isChartLoading: false,
            }
          : item
      )));
      toast.success(t('workspace.chartGeneratedSuccess'));
      loadHistory();
    } catch (error) {
      setMessages((prev) => prev.map((item, idx) => (
        idx === messageIndex ? { ...item, isChartLoading: false } : item
      )));
      toast.error(t('workspace.chartGeneratedError'), {
        description: error.message,
      });
    }
  };

  const handleLoadConversation = async (qaSession: QASessionRecord) => {
    const conversationHistory = qaSession.conversationHistory || qaSession.conversation_history || [];
    
    // Reconstruir o array de mensagens a partir do formato do backend
    const loadedMessages: ChatMessage[] = [];
    
    // Se conversation_history estiver vazio mas existir question e answer, usar esses valores
    if (conversationHistory.length === 0 && qaSession.question && qaSession.answer) {
      loadedMessages.push({
        role: "user",
        content: qaSession.question
      });
      
      // Verificar se há imageUrl no table_data para sessões antigas
      const imageUrl = qaSession.imageUrl || qaSession.table_data?.image_url;
      
      loadedMessages.push({
        role: "assistant",
        content: stripFollowUpsFromAnswer(qaSession.answer, qaSession.follow_up_questions),
        imageUrl: imageUrl
      });
    } else {
      // Caso contrário, processar conversation_history normalmente
      conversationHistory.forEach((entry) => {
        // Adicionar pergunta do usuário
        loadedMessages.push({
          role: "user",
          content: entry.question
        });
        
        // Adicionar resposta do assistente com imageUrl se disponível
        loadedMessages.push({
          role: "assistant",
          content: stripFollowUpsFromAnswer(entry.answer, entry.followUpQuestions),
          imageUrl: entry.imageUrl,
          turnId: entry.id,
          followUpQuestions: entry.followUpQuestions || [],
          chartInput: entry.chartInput,
          chartSpec: entry.chartSpec,
          chartScript: entry.chartScript,
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
      } catch (error) {
        console.error("Erro ao ativar fonte da conversa:", error);
      }
    }
    
    toast.success("Conversa carregada", {
      description: "Você pode continuar de onde parou.",
    });
  };

  const handleSendMessage = async () => {
    const userMessage = getQuestionFullText().trim();
    if (!userMessage || !id) return;
    setMessages([...messages, {
      role: "user",
      content: userMessage
    }]);
    setQuestionSegments([]);
    setQuestionInput("");
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
        imageUrl: data.imageUrl,
        turnId: data.turnId,
        followUpQuestions: data.followUpQuestions || [],
        chartInput: data.chartInput,
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
    } catch (error) {
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
        <div className="w-80 flex-shrink-0 bg-card border rounded-xl overflow-hidden flex flex-col" data-walkthrough="ws-sources-panel">
          <SourcesPanel 
            agentId={id} 
            onAddSource={() => setAddSourceOpen(true)}
            refreshTrigger={sourcesRefreshTrigger}
            onSourceActivated={handleSourceContextChanged}
          />
        </div>

        {/* Chat Panel - Center */}
        <div className="flex-1 min-h-0 flex flex-col bg-card border rounded-xl overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between h-[57px]" data-walkthrough="ws-header">
            <h1 className="font-semibold">{t('workspace.chat')}</h1>
            
            <div className="flex items-center gap-2">
              {id && sqlSourcesCount >= 2 && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSqlRelationshipsOpen(true)}
                  title={t("sources.relationships")}
                >
                  <Link2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                onClick={() => setLogsModalOpen(true)}
                title={t('logs.button')}
                data-walkthrough="ws-logs-btn"
              >
                <Terminal className="h-4 w-4" />
              </Button>
              <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" data-walkthrough="ws-history-btn">
                    <History className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                
              <Button
                variant="outline"
                size="icon"
                onClick={clearConversation}
                title={t('questions.clearConversation')}
                data-walkthrough="ws-clear-btn"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsSettingsOpen(true)}
                title={t('agentSettings.title')}
                data-walkthrough="ws-agent-settings-btn"
              >
                <Bot className="h-4 w-4" />
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
                      {history.map((qaSession) => (
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

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6" data-walkthrough="ws-chat-area">
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
                      onClick={() => {
                        setQuestionSegments((prev) => [
                          ...prev,
                          { type: "text", value: questionInput + (questionInput ? " " : "") },
                          { type: "column", name: column },
                        ]);
                        setQuestionInput("");
                      }}
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
                      onClick={() => {
                      setQuestionSegments([{ type: "text", value: question }]);
                      setQuestionInput("");
                    }}
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
                      <div
                        className={`group relative rounded-lg p-4 max-w-[80%] ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "border border-border/60 bg-muted/70 text-foreground"
                        }`}
                      >
                        <div className="absolute -top-2 right-0 flex items-center gap-1">
                          {message.role === "assistant" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity bg-background border shadow-sm hover:bg-primary/10 hover:text-primary"
                              onClick={() => handleGenerateChart(index)}
                              title={t('workspace.generateChart')}
                              disabled={message.isChartLoading || !currentSessionId}
                            >
                              <BarChart3 className={`h-3.5 w-3.5 ${message.isChartLoading ? 'animate-pulse' : ''}`} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background border shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => handleDeleteMessage(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <div
                          className={`prose prose-sm max-w-none ${
                            message.role === "user"
                              ? "text-primary-foreground prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground prose-a:text-primary-foreground prose-li:text-primary-foreground prose-code:bg-primary-foreground/10 prose-code:text-primary-foreground prose-pre:border-primary-foreground/15 prose-pre:bg-primary-foreground/10 prose-pre:text-primary-foreground prose-blockquote:border-primary-foreground/30 prose-blockquote:text-primary-foreground"
                              : "text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-a:text-primary prose-li:text-foreground prose-code:bg-background/60 prose-code:text-foreground prose-pre:border-border prose-pre:bg-background/70 prose-pre:text-foreground prose-blockquote:border-border prose-blockquote:text-foreground"
                          }`}
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                        {message.role === "assistant" && message.isChartLoading && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            {t('workspace.generatingChart')}
                          </p>
                        )}
                      </div>
                    </div>
                    {(message.chartSpec || message.imageUrl) && (
                      <div className="flex justify-start">
                        <div className="max-w-[90%] w-full">
                          {message.chartSpec && (message.chartSpec as ChartSpec).categories ? (
                            <div className="mt-3 relative group">
                              <ChartRenderer
                                spec={message.chartSpec as ChartSpec}
                                className="w-full"
                              />
                              {message.role === "assistant" && (
                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleRemoveImageFromMessage(index)}
                                    className="h-6 w-6"
                                    title={t('workspace.removeImage') || 'Remover gráfico'}
                                  >
                                    <X className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : message.imageUrl ? (
                            <ChartImage
                              imageUrl={message.imageUrl}
                              qaSessionId={currentSessionId || undefined}
                              t={t}
                              onRemoveImage={message.role === "assistant" ? () => handleRemoveImageFromMessage(index) : undefined}
                            />
                          ) : null}
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
                      onClick={() => {
                      setQuestionSegments([{ type: "text", value: fq }]);
                      setQuestionInput("");
                    }}
                    >
                      {fq}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-2" data-walkthrough="ws-chat-input">
                <div className="flex-1 min-w-0 h-12 flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 has-[:disabled]:opacity-50">
                  {questionSegments.map((seg, i) =>
                    seg.type === "text" ? (
                      seg.value ? (
                        <span key={i} className="whitespace-pre-wrap break-words">
                          {seg.value}
                        </span>
                      ) : null
                    ) : (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="font-mono text-xs h-6 px-2 bg-primary/15 text-primary border border-primary/30"
                      >
                        {seg.name}
                      </Badge>
                    )
                  )}
                  <input
                    className="flex-1 min-w-[120px] h-6 bg-transparent border-0 outline-none placeholder:text-muted-foreground"
                    value={questionInput}
                    onChange={(e) => setQuestionInput(e.target.value)}
                    placeholder={questionSegments.length === 0 && !questionInput ? (llmConfigured === false ? t("workspace.noLlmConfigured") : hasSources ? t("workspace.inputPlaceholder") : t("workspace.addSourceFirst")) : ""}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !isLoading && hasSources && llmConfigured !== false) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                      if (e.key === "Backspace" && !questionInput && questionSegments.length > 0) {
                        e.preventDefault();
                        setQuestionSegments((prev) => {
                          const last = prev[prev.length - 1];
                          if (last?.type === "text" && last.value.length > 0) {
                            const newVal = last.value.slice(0, -1);
                            if (newVal === "") return prev.slice(0, -1);
                            return [...prev.slice(0, -1), { type: "text" as const, value: newVal }];
                          }
                          return prev.slice(0, -1);
                        });
                      }
                    }}
                    disabled={!hasSources || isLoading || llmConfigured === false}
                  />
                </div>
                <Button onClick={handleSendMessage} disabled={!getQuestionFullText().trim() || !hasSources || isLoading || llmConfigured === false} className="h-12">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              
            </div>
          </div>
        </div>

        {/* Studio Panel - Right */}
        {!studioPanelCollapsed && <div className="w-80 flex-shrink-0 bg-card border rounded-xl overflow-hidden flex flex-col" data-walkthrough="ws-studio-panel">
            <StudioPanel
              workspaceType={workspaceType}
              collapsed={studioPanelCollapsed}
              onToggleCollapse={() => setStudioPanelCollapsed(!studioPanelCollapsed)}
              onOpenGraph={() => setGraphModalOpen(true)}
              onOpenSummary={() => setSummaryModalOpen(true)}
              onOpenAudio={() => setAudioOverviewModalOpen(true)}
              onOpenAutoML={() => setAutoMLModalOpen(true)}
              onOpenReport={() => setReportModalOpen(true)}
              onOpenTemplates={() => setTemplateModalOpen(true)}
              onOpenMessaging={() => setIsMessagingModalOpen(true)}
              onOpenApiAccess={() => setIsApiAccessModalOpen(true)}
              onOpenMedallion={() => setMedallionOpen(true)}
              onOpenAlerts={() => setAlertModalOpen(true)}
              onOpenCdpWizard={() => setCdpWizardOpen(true)}
              onOpenPipelines={() => setEtlPipelineOpen(true)}
              onOpenTransforms={() => setEtlPipelineOpen(true)}
              onOpenLineage={() => setEtlPipelineOpen(true)}
            />
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
        loadSqlSourcesCount();
      }} />

      {id && (
        <SqlRelationshipsModal
          open={sqlRelationshipsOpen}
          onOpenChange={setSqlRelationshipsOpen}
          agentId={id}
          onSaved={handleSourceContextChanged}
        />
      )}
      
      <AgentSettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        agentId={id || ''}
        onSettingsUpdated={() => {
          loadWarmupQuestions();
          checkLlmStatus();
          toast.success("Configurações atualizadas");
        }}
      />

      <MessagingModal
        open={isMessagingModalOpen}
        onOpenChange={setIsMessagingModalOpen}
        agentId={id || ''}
      />

      <ApiAccessModal
        open={isApiAccessModalOpen}
        onOpenChange={setIsApiAccessModalOpen}
        agentId={id || ''}
      />

      <GraphViewModal
        open={graphModalOpen}
        onOpenChange={setGraphModalOpen}
        workspaceId={id || ''}
      />

      <SummaryModal
        open={summaryModalOpen}
        onOpenChange={setSummaryModalOpen}
        workspaceId={id || ''}
      />

      <AudioOverviewModal
        open={audioOverviewModalOpen}
        onOpenChange={setAudioOverviewModalOpen}
        workspaceId={id || ''}
      />

      <AutoMLModal
        open={autoMLModalOpen}
        onOpenChange={setAutoMLModalOpen}
        workspaceId={id || ''}
      />

      <MedallionPanel
        open={medallionOpen}
        onOpenChange={setMedallionOpen}
        agentId={id || ''}
        sourceId=""
      />

      <AlertModal
        open={alertModalOpen}
        onOpenChange={setAlertModalOpen}
        agentId={id || ''}
      />

      <CdpWizardModal
        open={cdpWizardOpen}
        onOpenChange={setCdpWizardOpen}
        agentId={id || ''}
      />

      <EtlPipelineModal
        open={etlPipelineOpen}
        onOpenChange={setEtlPipelineOpen}
        agentId={id || ''}
      />

      <ReportModal
        open={reportModalOpen}
        onOpenChange={setReportModalOpen}
        workspaceId={id || ''}
      />

      <TemplateModal
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        workspaceId={id || ''}
        onUseInChat={(question) => {
          setQuestionInput(question);
          setTemplateModalOpen(false);
        }}
      />

      <LogsModal open={logsModalOpen} onOpenChange={setLogsModalOpen} />
    </div>;
}