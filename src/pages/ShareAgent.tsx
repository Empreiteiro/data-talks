import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabaseClient } from "@/services/supabaseClient";
import { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ShareAgent = () => {
  const { token = "" } = useParams();
  const [agent, setAgent] = useState<any>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  
  // Get suggested questions from agent
  const suggestedQuestions = agent?.suggested_questions || [];

  useEffect(() => {
    async function loadAgent() {
      try {
        setAgentLoading(true);
        const agentData = await supabaseClient.getSharedAgent(token);
        setAgent(agentData);
        
        // Load history for shared agent
        if (agentData?.id) {
          const agentHistory = await supabaseClient.getSharedAgentQASessions(token);
          setHistory(agentHistory);
        }
      } catch (error) {
        console.error('Error loading shared agent:', error);
        setAgent(null);
      } finally {
        setAgentLoading(false);
      }
    }

    if (token) {
      loadAgent();
    }
  }, [token]);

  // Reload history when version changes (after new question)
  useEffect(() => {
    async function reloadHistory() {
      if (agent?.id && version > 0) {
        try {
          const agentHistory = await supabaseClient.getSharedAgentQASessions(token);
          setHistory(agentHistory);
        } catch (error) {
          console.error('Error reloading history:', error);
        }
      }
    }
    
    reloadHistory();
  }, [agent?.id, version]);

  async function access() {
    if (!agent) return;
    
    try {
      setError(null);
      const isValid = await supabaseClient.verifyAgentSharePassword(token, password);
      if (isValid) {
        setAuthorized(true);
      } else {
        setError("Senha incorreta. Tente novamente.");
      }
    } catch (error) {
      setError("Erro ao verificar senha. Tente novamente.");
    }
  }

  async function ask(sessionId?: string) {
    if (!agent || !question.trim()) return;
    
    try {
      setLoading(true);
      await supabaseClient.askQuestionShared(agent.id, question, token, sessionId);
      setQuestion("");
      setVersion(v => v + 1);
    } catch (error: any) {
      alert(`Erro: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  if (agentLoading) {
    return (
      <main className="container py-10">
        <SEO title="Carregando... | Converse com seus dados" description="Carregando agente compartilhado" canonical={`/share/${token}`} />
        <Card className="shadow-sm">
          <CardContent className="py-10">
            <p className="text-center text-muted-foreground">Carregando agente...</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!agent) {
    return (
      <main className="container py-10">
        <SEO title="Link inválido | Converse com seus dados" description="Agente não encontrado" canonical={`/share/${token}`} />
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Agente não encontrado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Verifique se o link está correto com quem compartilhou.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container py-10">
      <SEO title={`${agent.name || 'Agente compartilhado'} | Converse com seus dados`} description="Acesse um agente compartilhado com senha" canonical={`/share/${token}`} />
      <h1 className="text-3xl font-semibold mb-6">Acesso ao agente: <span className="text-muted-foreground">{agent.name || agent.id.slice(0,6) + '...'}</span></h1>

      {agent.has_password && !authorized ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Acesso protegido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Digite a senha para acessar este agente.</p>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" />
            <div className="flex items-center gap-2">
              <Button onClick={access} disabled={!password}>Acessar</Button>
              {error && <span className="text-sm text-destructive">{error}</span>}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Fazer pergunta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Qual a receita dos últimos 3 meses por região?" />
                <Button onClick={() => ask()} disabled={!question || loading}>{loading ? 'Perguntando...' : 'Perguntar'}</Button>
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
            </CardContent>
          </Card>

          <div className="grid gap-6">
            {history.map(h => (
              <Card key={h.id} className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Pergunta: <span className="text-muted-foreground font-normal">{h.question}</span></CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Main answer */}
                  <div className="prose prose-sm max-w-none">
                    {h.answerText.split('\n').map((line: string, index: number) => (
                      <p key={index} className="mb-2 last:mb-0">{line}</p>
                    ))}
                  </div>
                  
                  {h.imageUrl && (
                    <div className="mt-4">
                      <img 
                        src={h.imageUrl} 
                        alt="Resultado da análise" 
                        className="max-w-full h-auto rounded-lg shadow-sm"
                        onError={(e) => {
                          console.error('Erro ao carregar imagem:', h.imageUrl);
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  {/* Conversation History - Follow-up questions and answers (skip first if it's the same as main question) */}
                  {h.conversationHistory && h.conversationHistory.length > 0 && (
                    <div className="mt-6 space-y-4">
                      {h.conversationHistory.slice(1).map((conversation: any, index: number) => (
                        <div key={index} className="space-y-2">
                          <div className="text-sm">
                            <span className="font-medium">Pergunta:</span> {conversation.question}
                          </div>
                          <div className="prose prose-sm max-w-none dark:prose-invert">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {conversation.answer}
                            </ReactMarkdown>
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
                  
                  
                  {h.answerTableJSON && (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(h.answerTableJSON[0] || {}).map((c) => <TableHead key={c}>{c}</TableHead>)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {h.answerTableJSON.map((row, i) => (
                            <TableRow key={i}>
                              {Object.keys(h.answerTableJSON![0] || {}).map((c) => <TableCell key={c}>{String((row as any)[c])}</TableCell>)}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Latency: {h.latencyMs}ms · Status: {h.status}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </main>
  );
};

export default ShareAgent;
