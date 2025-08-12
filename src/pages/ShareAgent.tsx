import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agentClient } from "@/services/agentClient";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

const ShareAgent = () => {
  const { token = "" } = useParams();
  const agent = useMemo(() => agentClient.getAgentByShareToken(token), [token]);
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const history = useMemo(() => agent ? agentClient.listHistory(agent.id) : [], [agent, version]);

  function access() {
    if (!agent) return;
    const ok = agentClient.verifySharePassword(agent.id, password);
    if (ok) {
      setAuthorized(true);
      setError(null);
    } else {
      setError("Senha incorreta. Tente novamente.");
    }
  }

  function ask() {
    if (!agent) return;
    setLoading(true);
    setTimeout(() => {
      agentClient.ask(agent.id, question);
      setQuestion("");
      setLoading(false);
      setVersion(v => v + 1);
    }, 400);
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

      {!authorized ? (
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
            <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Qual a receita dos últimos 3 meses por região?" />
              <Button onClick={ask} disabled={!question || loading}>{loading ? 'Perguntando...' : 'Perguntar'}</Button>
            </CardContent>
          </Card>

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

export default ShareAgent;
