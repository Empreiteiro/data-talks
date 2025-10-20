import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { agentClient } from "@/services/agentClient";
import UsageMonitoring from "@/components/UsageMonitoring";
import SubscriptionManagement from "@/components/SubscriptionManagement";
import { BigQueryCredentialsManager } from "@/components/BigQueryCredentialsManager";
import UsersManagement from "@/components/UsersManagement";
import WorkspaceAccessManagement from "@/components/WorkspaceAccessManagement";
import { Activity, CreditCard, Database, Settings, Users as UsersIcon, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/hooks/useAuth";

const Account = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { data: currentUserRole } = useUserRole(user?.id);
  const [activeSection, setActiveSection] = useState("usage");

  const isAdmin = currentUserRole === 'admin';

  const menuItems = [
    { id: "usage", label: t('account.tabs.usage'), icon: Activity },
    { id: "subscription", label: t('account.tabs.subscription'), icon: CreditCard },
    { id: "credentials", label: t('account.tabs.credentials'), icon: Database },
    ...(isAdmin ? [
      { id: "users", label: t('account.tabs.users'), icon: UsersIcon },
      { id: "access", label: t('account.tabs.access'), icon: Shield },
    ] : []),
    { id: "settings", label: t('account.tabs.settings'), icon: Settings },
  ];

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

      <div className="flex gap-6">
        {/* Left Sidebar Menu */}
        <div className="w-64 flex-shrink-0">
          <div className="h-full flex flex-col bg-background border rounded-lg">
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-1">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        "w-full p-3 rounded-lg transition-colors text-left flex items-center gap-3",
                        activeSection === item.id
                          ? "bg-primary/10 border border-primary/20 text-primary font-medium"
                          : "hover:bg-muted/50 text-muted-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1">
          {activeSection === "usage" && <UsageMonitoring />}
          
          {activeSection === "subscription" && <SubscriptionManagement />}
          
          {activeSection === "credentials" && <BigQueryCredentialsManager />}
          
          {activeSection === "users" && isAdmin && <UsersManagement />}
          
          {activeSection === "access" && isAdmin && <WorkspaceAccessManagement />}
          
          {activeSection === "settings" && (
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
          )}
        </div>
      </div>
    </main>
  );
};

export default Account;
