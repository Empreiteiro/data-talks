import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { agentClient } from "@/services/agentClient";

const Account = () => {
  function exportHistory() {
    const qa = agentClient.listHistory();
    const blob = new Blob([JSON.stringify(qa, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'qa-history.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function deleteAll() {
    if (confirm('Tem certeza que deseja excluir sua conta e dados locais?')) {
      localStorage.clear();
      location.href = '/';
    }
  }

  return (
    <main className="container py-10">
      <SEO title="Conta | Converse com seus dados" description="Exportar histórico, excluir conta/dados" canonical="/account" />
      <h1 className="text-3xl font-semibold mb-6">Conta</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Exportação</CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={exportHistory}>Exportar histórico</Button>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Segurança</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={deleteAll}>Excluir conta e dados</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default Account;
