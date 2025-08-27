import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { v4 as uuidv4 } from 'uuid';

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { agentClient, Agent, QASession } from "@/services/agentClient";
import { supabaseClient } from "@/services/supabaseClient";
import { cn } from "@/lib/utils";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { PlanLimitAlert } from "@/components/PlanLimitAlert";

export default function Questions() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [conversationHistory, setConversationHistory] = useState<any[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { agentId: agentIdParam, shareToken: shareTokenParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSharedAgent, setIsSharedAgent] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const { limits, usage, planName, canAskQuestion, isLoading: limitsLoading } = usePlanLimits();

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        let agentList: Agent[] = [];

        if (shareTokenParam) {
          // Load shared agent
          setIsSharedAgent(true);
          setShareToken(shareTokenParam);

          const sharedAgent = await supabaseClient.getSharedAgent(shareTokenParam);
          if (sharedAgent) {
            const agent: Agent = {
              id: agentIdParam || 'shared',
              ownerId: 'shared',
              name: sharedAgent.name,
              description: sharedAgent.description,
              createdAt: sharedAgent.created_at,
              shareToken: shareTokenParam,
              sharePassword: sharedAgent.has_password ? 'protected' : undefined,
            };
            agentList = [agent];
            setSelectedAgent(agent);
          } else {
            toast.error("Agente não encontrado", {
              description: "O agente compartilhado não foi encontrado.",
            });
            return navigate('/agents');
          }

          // Load QA history for shared agent
          const qaSessions = await supabaseClient.getSharedAgentQASessions(shareTokenParam);
          setHistory(qaSessions);
        } else {
          // Load user's agents
          const agentsData = await supabaseClient.listAgents();
          // Map database fields to Agent interface
          agentList = agentsData.map(agent => ({
            id: agent.id,
            ownerId: user?.id || '',
            name: agent.name,
            description: agent.description || '',
            createdAt: agent.created_at,
            shareToken: uuidv4(), // Generate a placeholder token
            suggestedQuestions: agent.suggested_questions || []
          }));
          setAgents(agentList);

          if (agentIdParam) {
            const agent = agentList.find(a => a.id === agentIdParam);
            if (agent) {
              setSelectedAgent(agent);
            }
          }

          // Load QA history for user's agents
          const qaSessions = await supabaseClient.listQASessions(agentIdParam);
          setHistory(qaSessions);
        }

        if (agentList.length === 0 && !shareTokenParam) {
          toast.error("Nenhum agente encontrado", {
            description: "Crie um agente para começar a fazer perguntas.",
          });
          return navigate('/agents/new');
        }
      } catch (error: any) {
        toast.error("Erro ao carregar dados", {
          description: error.message,
        });
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, [agentIdParam, shareTokenParam, navigate]);

  // Reload history when selected agent changes
  useEffect(() => {
    const loadAgentHistory = async () => {
      if (selectedAgent && !isSharedAgent) {
        try {
          const qaSessions = await supabaseClient.listQASessions(selectedAgent.id);
          setHistory(qaSessions);
        } catch (error: any) {
          console.error('Error loading agent history:', error);
        }
      }
    };

    loadAgentHistory();
  }, [selectedAgent, isSharedAgent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!canAskQuestion) {
      toast.error("Limite mensal atingido", {
        description: `Você atingiu o limite de ${limits.monthlyQuestions} perguntas mensais do plano ${planName}.`,
      });
      return;
    }

    if (!question.trim()) return;
    if (!selectedAgent) {
      toast.error("Agente obrigatório", {
        description: "Selecione um agente para fazer a pergunta.",
      });
      return;
    }

    setSubmitting(true);
    setAnswer(null);
    setImageUrl(null);
    setFollowUpQuestions([]);

    try {
      let response;
      if (isSharedAgent && shareToken) {
        response = await supabaseClient.askQuestionShared(selectedAgent.id, question, shareToken, sessionId);
      } else {
        response = await supabaseClient.askQuestion(selectedAgent.id, question, sessionId);
      }

      setAnswer(response.answer);
      setImageUrl(response.imageUrl);
      setSessionId(response.sessionId);
      setFollowUpQuestions(response.followUpQuestions);

      // Update conversation history
      const newEntry = {
        question: question,
        answer: response.answer,
        imageUrl: response.imageUrl,
        followUpQuestions: response.followUpQuestions,
        timestamp: new Date().toISOString()
      };
      setConversationHistory(prevHistory => [...(prevHistory || []), newEntry]);

      // Refresh history
      if (!isSharedAgent) {
        const qaSessions = await supabaseClient.listQASessions(selectedAgent.id);
        setHistory(qaSessions);
      } else if (shareToken) {
        const qaSessions = await supabaseClient.getSharedAgentQASessions(shareToken);
        setHistory(qaSessions);
      }
    } catch (error: any) {
      toast.error("Erro ao enviar pergunta", {
        description: error.message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleFollowUpQuestion = (followUp: string) => {
    setQuestion(followUp);
    handleSubmit(new Event('submit') as any); // Trigger form submission
  };

  if (loading || limitsLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Carregando perguntas...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Perguntas aos Agentes</h1>
        <p className="text-muted-foreground">
          Faça perguntas aos seus agentes de IA ({usage.monthlyQuestions}/{limits.monthlyQuestions} este mês - Plano {planName})
        </p>
      </div>

      {!canAskQuestion && (
        <PlanLimitAlert
          type="questions"
          limit={limits.monthlyQuestions}
          planName={planName}
          className="mb-6"
        />
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Nova Pergunta</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="agent">Agente</Label>
              {!isSharedAgent ? (
                <Select value={selectedAgent?.id} onValueChange={(value) => {
                  const agent = agents.find((a) => a.id === value);
                  if (agent) {
                    setSelectedAgent(agent);
                  }
                }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione um agente" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={selectedAgent?.name}
                  disabled
                />
              )}
            </div>
            
            <div className="flex space-x-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={canAskQuestion ? "Digite sua pergunta..." : "Limite mensal atingido"}
                className="flex-1"
                disabled={!selectedAgent || submitting || !canAskQuestion}
              />
              <Button 
                type="submit" 
                disabled={!selectedAgent || submitting || !question.trim() || !canAskQuestion}
              >
                {submitting ? "Enviando..." : "Enviar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {selectedAgent?.suggestedQuestions && selectedAgent.suggestedQuestions.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Perguntas Sugeridas</CardTitle>
            <CardDescription>Clique em uma pergunta para enviá-la</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {selectedAgent.suggestedQuestions.map((suggestedQuestion, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="justify-start text-left h-auto py-3 px-4"
                  onClick={() => setQuestion(suggestedQuestion)}
                  disabled={!canAskQuestion}
                >
                  {suggestedQuestion}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {answer && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Resposta</CardTitle>
            <CardDescription>Resposta do agente {selectedAgent?.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {imageUrl && (
              <div className="flex justify-center">
                <img src={imageUrl} alt="Resposta do Agente" className="max-w-full" />
              </div>
            )}
            <p>{answer}</p>

            {followUpQuestions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Perguntas de acompanhamento:</h3>
                <div className="flex flex-wrap gap-2">
                  {followUpQuestions.map((followUp, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() => handleFollowUpQuestion(followUp)}
                    >
                      {followUp}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de Perguntas</CardTitle>
          <CardDescription>Suas perguntas anteriores para este agente</CardDescription>
        </CardHeader>
        <CardContent className="h-[400px]">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              {history.map((qaSession: any) => (
                <div key={qaSession.id} className="border rounded-md p-4">
                  <div className="flex items-center space-x-4 mb-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={`https://avatar.vercel.sh/${qaSession.user_id}.png`} />
                      <AvatarFallback>IA</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{qaSession.question}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(qaSession.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                   {qaSession.imageUrl && (
                     <div className="mb-2">
                       <img src={qaSession.imageUrl} alt="Chart" className="max-w-full h-auto rounded" />
                     </div>
                   )}
                   <p className="text-sm text-muted-foreground">{qaSession.answerText || qaSession.answer}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <Button variant="link" onClick={() => setHistory([])}>Limpar histórico</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
