import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabaseClient } from "@/services/supabaseClient";
import { ThumbsDown, ThumbsUp, Trash2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const Questions = () => {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => supabaseClient.listAgents()
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['qa-sessions', agentId],
    queryFn: () => supabaseClient.listQASessions(agentId || undefined)
  });

  // Set default agent when agents load
  if (agents.length > 0 && !agentId) {
    setAgentId(agents[0].id);
  }

  // Get current agent's suggested questions
  const currentAgent = agents.find(a => a.id === agentId);
  const suggestedQuestions = currentAgent?.suggested_questions || [];

  async function ask(sessionId?: string) {
    if (!question.trim() || !agentId) return;

    try {
      setIsLoading(true);
      const currentQuestion = question;
      setQuestion('');
      const result = await supabaseClient.askQuestion(agentId, currentQuestion, sessionId);
      
      // Refresh sessions to show the new question
      queryClient.invalidateQueries({ queryKey: ['qa-sessions'] });
      
    } catch (error: any) {
      alert(`Erro: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateFeedback(sessionId: string, feedback: 'positive' | 'negative') {
    try {
      await supabaseClient.updateQASessionFeedback(sessionId, feedback);
      queryClient.invalidateQueries({ queryKey: ['qa-sessions'] });
    } catch (error: any) {
      alert(`Erro ao salvar feedback: ${error.message}`);
    }
  }

  return (
    <main className="container py-10">
      <SEO title="Perguntas | Converse com seus dados" description="Faça perguntas em linguagem natural" canonical="/questions" />
      <h1 className="text-3xl font-semibold mb-6">Perguntas</h1>

      {agents.length === 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Antes de começar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Crie um agente em "Briefing" para começar a perguntar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">Agente</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full border rounded-md px-3 py-2 bg-background">
                {agents.map(a => <option key={a.id} value={a.id}>{a.name || `${a.id.slice(0,6)}...`}</option>)}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Qual a receita dos últimos 3 meses por região?" disabled={isLoading} />
              <Button onClick={() => ask()} disabled={!question || isLoading} className="min-w-[120px]">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processando...
                  </>
                ) : (
                  'Perguntar'
                )}
              </Button>
            </div>
            
            {suggestedQuestions.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">Perguntas sugeridas</label>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((suggestedQuestion, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() => setQuestion(suggestedQuestion)}
                      className="text-sm"
                    >
                      {suggestedQuestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-6">
            {isLoading && (
              <Card className="shadow-sm animate-pulse">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-center space-x-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <p className="text-muted-foreground">Processando sua pergunta...</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {sessions.length === 0 && !isLoading ? (
              <Card className="shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-center">
                    Nenhuma pergunta encontrada. Faça sua primeira pergunta acima.
                  </p>
                </CardContent>
              </Card>
            ) : (
              sessions.map((h: any) => (
                <Card key={h.id} className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">Pergunta: <span className="text-muted-foreground font-normal">{h.question}</span></CardTitle>
                  </CardHeader>
                   <CardContent className="space-y-4">
                     {/* Main answer */}
                     <div className="prose prose-sm max-w-none">
                       {(h.answer || 'Resposta não disponível').split('\n').map((line: string, index: number) => (
                         <p key={index} className="mb-2 last:mb-0">{line}</p>
                       ))}
                     </div>
                     
                    {h.table_data?.image_url && (
                      <div className="mt-4">
                        <img 
                          src={h.table_data.image_url} 
                          alt="Resultado da análise" 
                          className="max-w-full h-auto rounded-lg shadow-sm"
                        />
                      </div>
                    )}

                    {/* Conversation History - Follow-up questions and answers */}
                    {h.conversation_history && h.conversation_history.length > 0 && (
                      <div className="mt-6 space-y-4">
                        <h4 className="text-sm font-medium text-muted-foreground">Histórico da conversa:</h4>
                        {h.conversation_history.map((conversation: any, index: number) => (
                          <div key={index} className="border-l-2 border-border pl-4 space-y-2">
                            <div className="text-sm">
                              <span className="font-medium">Pergunta:</span> {conversation.question}
                            </div>
                            <div className="prose prose-sm max-w-none">
                              {conversation.answer.split('\n').map((line: string, lineIndex: number) => (
                                <p key={lineIndex} className="mb-1 last:mb-0 text-sm">{line}</p>
                              ))}
                            </div>
                            {conversation.imageUrl && (
                              <div className="mt-2">
                                <img 
                                  src={conversation.imageUrl} 
                                  alt="Resultado da análise" 
                                  className="max-w-full h-auto rounded-lg shadow-sm"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {h.table_data && !h.table_data.image_url && Array.isArray(h.table_data) && (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(h.table_data[0] || {}).map((c) => <TableHead key={c}>{c}</TableHead>)}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {h.table_data.map((row: any, i: number) => (
                              <TableRow key={i}>
                                {Object.keys(h.table_data[0] || {}).map((c) => <TableCell key={c}>{String(row[c])}</TableCell>)}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    
                    {/* Follow-up Questions */}
                    {h.follow_up_questions && h.follow_up_questions.length > 0 && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium">Perguntas de aprofundamento</label>
                        <div className="flex flex-wrap gap-2">
                          {h.follow_up_questions.map((followUpQuestion: string, index: number) => (
                            <Button
                              key={index}
                              variant="outline"
                              size="sm"
                            onClick={() => {
                              setQuestion(followUpQuestion);
                              setTimeout(() => ask(h.id), 0);
                            }}
                              className="text-sm"
                            >
                              {followUpQuestion}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button 
                          variant={h.feedback === 'positive' ? 'default' : 'ghost'} 
                          size="sm" 
                          aria-label="Feedback positivo"
                          onClick={() => updateFeedback(h.id, 'positive')}
                        >
                          <ThumbsUp />
                        </Button>
                        <Button 
                          variant={h.feedback === 'negative' ? 'default' : 'ghost'} 
                          size="sm" 
                          aria-label="Feedback negativo"
                          onClick={() => updateFeedback(h.id, 'negative')}
                        >
                          <ThumbsDown />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Deletar pergunta"
                        onClick={async () => { 
                          if (confirm('Tem certeza que deseja deletar esta pergunta?')) {
                            try {
                              await supabaseClient.deleteQASession(h.id);
                              queryClient.invalidateQueries({ queryKey: ['qa-sessions'] });
                            } catch (e: any) {
                              alert(e.message);
                            }
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleString('pt-BR')} · Status: {h.status}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default Questions;
