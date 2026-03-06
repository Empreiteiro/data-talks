import { useState, useMemo, useEffect } from "react";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import UsageMonitoring from "@/components/UsageMonitoring";
import { BigQueryCredentialsManager } from "@/components/BigQueryCredentialsManager";
import UsersManagement from "@/components/UsersManagement";
import { Activity, Bot, Database, FolderOpen, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourcesPanel } from "@/components/SourcesPanel";
import { AddSourceModal } from "@/components/AddSourceModal";
import { LLMPanel } from "@/components/LLMPanel";

const Account = () => {
  const { t } = useLanguage();
  const { loginRequired } = useAuth();
  const [activeSection, setActiveSection] = useState("usage");
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const menuItems = useMemo(() => {
    const items = [
      { id: "usage", label: t('account.tabs.usage'), icon: Activity },
      { id: "llm", label: t('account.tabs.llm'), icon: Bot },
      ...(loginRequired ? [{ id: "users", label: t('account.tabs.users'), icon: Users }] : []),
      { id: "sources", label: t('account.tabs.sources'), icon: FolderOpen },
      { id: "credentials", label: t('account.tabs.credentials'), icon: Database },
    ];
    return items;
  }, [t, loginRequired]);

  useEffect(() => {
    if (!loginRequired && activeSection === "users") setActiveSection("usage");
  }, [loginRequired, activeSection]);

  return (
    <main className="h-full min-h-0 flex flex-col overflow-hidden">
      <SEO title={`${t('account.title')} | ${t('nav.tagline')}`} description="Gerenciar conta" canonical="/account" />

      {/* Área que preenche da navbar até acima do botão de logs */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 sm:px-6 pt-4 pb-20">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-4 flex-shrink-0">{t('account.title')}</h1>

        <div className="flex items-stretch gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Menu lateral e painel à mesma altura (items-stretch) */}
          <div className="w-56 sm:w-64 flex-shrink-0 flex flex-col min-h-0 self-stretch">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-background border rounded-lg p-1.5">
              <div className="space-y-0.5 flex-shrink-0">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        "w-full py-2 px-2.5 rounded-md transition-colors text-left flex items-center gap-2.5",
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

          <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden self-stretch bg-background rounded-lg">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6" style={{ minHeight: 0 }}>
              {activeSection === "usage" && <UsageMonitoring />}
              {activeSection === "llm" && <LLMPanel />}
              {activeSection === "users" && <UsersManagement />}
              {activeSection === "sources" && (
                <SourcesPanel
                  onAddSource={() => setShowAddSourceModal(true)}
                  refreshTrigger={refreshTrigger}
                />
              )}
              {activeSection === "credentials" && <BigQueryCredentialsManager />}
            </div>
          </div>
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
