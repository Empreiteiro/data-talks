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
    <main className="min-h-full flex flex-col pb-6">
      <SEO title={`${t('account.title')} | ${t('nav.tagline')}`} description="Gerenciar conta" canonical="/account" />
      
      <div className="container py-6">
        <h1 className="text-3xl font-semibold mb-6">{t('account.title')}</h1>
      </div>

      <div className="flex gap-6 container flex-1">
        {/* Left Sidebar Menu — altura compacta para caber em uma dobra */}
        <div className="w-64 flex-shrink-0 self-start">
          <div className="bg-background border rounded-lg p-1.5">
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

        {/* Main Content Area */}
        <div className="flex-1 bg-background overflow-hidden">
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

      <AddSourceModal
        open={showAddSourceModal}
        onOpenChange={setShowAddSourceModal}
        onSourceAdded={() => setRefreshTrigger(prev => prev + 1)}
      />
    </main>
  );
};

export default Account;
