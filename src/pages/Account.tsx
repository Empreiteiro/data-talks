import { useState } from "react";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/contexts/LanguageContext";
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
  const [activeSection, setActiveSection] = useState("usage");
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const menuItems = [
    { id: "usage", label: t('account.tabs.usage'), icon: Activity },
    { id: "llm", label: t('account.tabs.llm'), icon: Bot },
    { id: "users", label: t('account.tabs.users'), icon: Users },
    { id: "sources", label: t('account.tabs.sources'), icon: FolderOpen },
    { id: "credentials", label: t('account.tabs.credentials'), icon: Database },
  ];

  return (
    <main className="min-h-full flex flex-col h-full">
      <SEO title={`${t('account.title')} | ${t('nav.tagline')}`} description="Gerenciar conta" canonical="/account" />

      {/* Espaço de respiro: padding até as bordas da tela */}
      <div className="flex-1 flex flex-col min-h-0 px-4 sm:px-6 py-4">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-4 flex-shrink-0">{t('account.title')}</h1>

        <div className="flex gap-4 flex-1 min-h-0">
          {/* Left Sidebar Menu */}
          <div className="w-56 sm:w-64 flex-shrink-0">
            <div className="h-full bg-background border rounded-lg p-1.5 min-h-0 flex flex-col">
              <div className="space-y-0.5">
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

          {/* Main Content Area — scroll só quando os registros superarem a altura */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-background border rounded-lg overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
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
