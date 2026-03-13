import { useState, useMemo, useEffect } from "react";
import { SEO } from "@/components/SEO";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import UsageMonitoring from "@/components/UsageMonitoring";
import { CredentialsView } from "@/components/CredentialsView";
import UsersManagement from "@/components/UsersManagement";
import { Activity, Bot, Database, FolderOpen, PlugZap, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourcesPanel } from "@/components/SourcesPanel";
import { AddSourceModal } from "@/components/AddSourceModal";
import { LLMPanel } from "@/components/LLMPanel";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import AuditTrail from "@/components/AuditTrail";
import { useSearchParams } from "react-router-dom";

const Account = () => {
  const { t } = useLanguage();
  const { loginRequired } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState("usage");
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const menuItems = useMemo(() => {
    const items = [
      { id: "usage", label: t('account.tabs.usage'), icon: Activity },
      { id: "llm", label: t('account.tabs.llm'), icon: Bot },
      { id: "connections", label: t('account.tabs.connections'), icon: PlugZap },
      ...(loginRequired ? [{ id: "users", label: t('account.tabs.users'), icon: Users }] : []),
      { id: "sources", label: t('account.tabs.sources'), icon: FolderOpen },
      { id: "credentials", label: t('account.tabs.credentials'), icon: Database },
      { id: "audit", label: t('account.tabs.audit'), icon: ShieldCheck },
    ];
    return items;
  }, [t, loginRequired]);

  useEffect(() => {
    if (!loginRequired && activeSection === "users") setActiveSection("usage");
  }, [loginRequired, activeSection]);

  useEffect(() => {
    const requestedSection = searchParams.get("section");
    if (!requestedSection) return;
    const isValidSection = menuItems.some((item) => item.id === requestedSection);
    if (isValidSection && requestedSection !== activeSection) {
      setActiveSection(requestedSection);
    }
  }, [searchParams, menuItems, activeSection]);

  const handleSectionChange = (sectionId: string) => {
    setActiveSection(sectionId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("section", sectionId);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <main className="h-full min-h-0 flex flex-col overflow-hidden">
      <SEO title={`${t('account.title')} | ${t('nav.tagline')}`} description="Gerenciar conta" canonical="/account" />

      {/* Área que preenche da navbar até acima do botão de logs */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 sm:px-6 pt-4 pb-20">
        <h1 className="text-2xl sm:text-3xl font-semibold mb-4 flex-shrink-0">{t('account.title')}</h1>

        {/* Grid: uma linha com altura total = as duas colunas sempre na mesma altura */}
        <div className="grid grid-cols-[14rem_1fr] sm:grid-cols-[16rem_1fr] grid-rows-[minmax(0,1fr)] gap-4 flex-1 min-h-0 overflow-hidden">
          <div className="min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 bg-background border rounded-lg p-1.5 flex flex-col">
              <div className="space-y-0.5">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSectionChange(item.id)}
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

          <div className="min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ minHeight: 0 }}>
              {activeSection === "usage" && <UsageMonitoring />}
              {activeSection === "llm" && <LLMPanel />}
              {activeSection === "connections" && <ConnectionsPanel />}
              {activeSection === "users" && <UsersManagement />}
              {activeSection === "sources" && (
                <SourcesPanel
                  onAddSource={() => setShowAddSourceModal(true)}
                  refreshTrigger={refreshTrigger}
                />
              )}
              {activeSection === "credentials" && <CredentialsView />}
              {activeSection === "audit" && <AuditTrail />}
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
