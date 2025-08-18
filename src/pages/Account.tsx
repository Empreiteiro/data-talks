import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { agentClient } from "@/services/agentClient";

const Account = () => {
  const { t } = useLanguage();

  function exportHistory() {
    const qa = agentClient.listHistory();
    const blob = new Blob([JSON.stringify(qa, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'qa-history.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function deleteAll() {
    if (confirm(t('account.deleteConfirm'))) {
      localStorage.clear();
      location.href = '/';
    }
  }

  return (
    <main className="container py-10">
      <SEO title={`${t('account.title')} | ${t('nav.tagline')}`} description="Exportar histórico, excluir conta/dados" canonical="/account" />
      <h1 className="text-3xl font-semibold mb-6">{t('account.title')}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>{t('account.export')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button onClick={exportHistory}>{t('account.exportHistory')}</Button>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>{t('account.security')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={deleteAll}>{t('account.deleteAccount')}</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default Account;
