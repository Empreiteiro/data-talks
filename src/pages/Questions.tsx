import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agentClient } from "@/services/agentClient";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";

const Questions = () => {
  const agents = agentClient.listAgents();
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const history = useMemo(() => agentClient.listHistory(agentId), [agentId, version]);

  function ask() {
    if (!agentId) return alert('Crie e ative um agente primeiro');
    setLoading(true);
    setTimeout(() => {
      agentClient.ask(agentId, question);
      setQuestion("");
      setLoading(false);
      setVersion(v => v + 1);
    }, 400);
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
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Qual a receita dos últimos 3 meses por região?" />
              <Button onClick={ask} disabled={!question || loading}>{loading ? 'Perguntando...' : 'Perguntar'}</Button>
            </div>
          </div>

          <div className="grid gap-6">
            {history.map(h => (
              <Card key={h.id} className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Pergunta: <span className="text-muted-foreground font-normal">{h.question}</span></CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p>{h.answerText}</p>
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
                  <div className="flex items-center gap-2">
                    <Button
                      variant={h.feedback === 'up' ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-label="Feedback positivo"
                      onClick={() => { agentClient.setFeedback(h.id, h.feedback === 'up' ? null : 'up'); setVersion(v => v + 1); }}
                    >
                      <ThumbsUp />
                    </Button>
                    <Button
                      variant={h.feedback === 'down' ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-label="Feedback negativo"
                      onClick={() => { agentClient.setFeedback(h.id, h.feedback === 'down' ? null : 'down'); setVersion(v => v + 1); }}
                    >
                      <ThumbsDown />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {new Date(h.createdAt).toLocaleString('pt-BR')} · Latency: {h.latencyMs}ms · Status: {h.status}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </main>
  );
};

export default Questions;
