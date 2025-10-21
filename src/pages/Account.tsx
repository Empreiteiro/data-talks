import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { agentClient } from "@/services/agentClient";
import UsageMonitoring from "@/components/UsageMonitoring";
import SubscriptionManagement from "@/components/SubscriptionManagement";
import { BigQueryCredentialsManager } from "@/components/BigQueryCredentialsManager";
import UsersManagement from "@/components/UsersManagement";
import WorkspaceAccessManagement from "@/components/WorkspaceAccessManagement";
import { Activity, CreditCard, Database, Settings, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourcesPanel } from "@/components/SourcesPanel";
import { AddSourceModal } from "@/components/AddSourceModal";

const Account = () => {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState("usage");
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const menuItems = [
    { id: "usage", label: t('account.tabs.usage'), icon: Activity },
    { id: "subscription", label: t('account.tabs.subscription'), icon: CreditCard },
    { id: "sources", label: t('account.tabs.sources'), icon: FolderOpen },
    { id: "credentials", label: t('account.tabs.credentials'), icon: Database },
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
    <main className="min-h-screen flex flex-col pb-6">
      <SEO title={`${t('account.title')} | ${t('nav.tagline')}`} description="Exportar histórico, excluir conta/dados" canonical="/account" />
      
      <div className="container py-6">
        <h1 className="text-3xl font-semibold mb-6">{t('account.title')}</h1>
      </div>

      <div className="flex gap-6 container flex-1">
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
        <div className="flex-1 bg-background overflow-hidden">
          {activeSection === "usage" && <UsageMonitoring />}
          
          {activeSection === "subscription" && (
            <Tabs defaultValue="subscription" className="h-full">
              <TabsList className="mb-6">
                <TabsTrigger value="subscription">{t('account.tabs.subscription')}</TabsTrigger>
                <TabsTrigger value="users">{t('account.tabs.users')}</TabsTrigger>
                <TabsTrigger value="workspaceAccess">{t('account.tabs.workspaceAccess')}</TabsTrigger>
              </TabsList>
              
              <TabsContent value="subscription" className="h-full">
                <SubscriptionManagement />
              </TabsContent>
              
              <TabsContent value="users">
                <UsersManagement />
              </TabsContent>
              
              <TabsContent value="workspaceAccess">
                <WorkspaceAccessManagement />
              </TabsContent>
            </Tabs>
          )}
          
          {activeSection === "sources" && (
            <SourcesPanel 
              onAddSource={() => setShowAddSourceModal(true)}
              refreshTrigger={refreshTrigger}
            />
          )}
          
          {activeSection === "credentials" && <BigQueryCredentialsManager />}
          
          {activeSection === "settings" && (
            <div className="grid gap-6">
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

      <AddSourceModal
        open={showAddSourceModal}
        onOpenChange={setShowAddSourceModal}
        onSourceAdded={() => setRefreshTrigger(prev => prev + 1)}
      />
    </main>
  );
};

export default Account;
