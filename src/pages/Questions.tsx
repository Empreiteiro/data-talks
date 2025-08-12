import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agentClient } from "@/services/agentClient";
import { useMemo, useState } from "react";

const Questions = () => {
  const agents = agentClient.listAgents();
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  const history = useMemo(() => agentClient.listHistory(agentId), [agentId]);

  function ask() {
    if (!agentId) return alert('Crie e ative um agente primeiro');
    setLoading(true);
    setTimeout(() => {
      agentClient.ask(agentId, question);
      setQuestion("");
      setLoading(false);
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
          <div className="grid gap-3 md:grid-cols-[240px_1fr_auto]">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="border rounded-md px-3 py-2 bg-background">
              {agents.map(a => <option key={a.id} value={a.id}>{a.id.slice(0,6)}... </option>)}
            </select>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Qual a receita dos últimos 3 meses por região?" />
            <Button onClick={ask} disabled={!question || loading}>{loading ? 'Perguntando...' : 'Perguntar'}</Button>
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

export default Questions;
