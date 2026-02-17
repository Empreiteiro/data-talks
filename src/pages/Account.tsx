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
import { Link } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const Account = () => {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState("usage");
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const menuItems = [
    { id: "usage", label: t("account.tabs.usage"), icon: Activity },
    { id: "llm", label: t("account.tabs.llm"), icon: Bot },
    { id: "users", label: t("account.tabs.users"), icon: Users },
    { id: "sources", label: t("account.tabs.sources"), icon: FolderOpen },
    { id: "credentials", label: t("account.tabs.credentials"), icon: Database },
  ];

  const activeLabel = menuItems.find((m) => m.id === activeSection)?.label ?? activeSection;

  return (
    <div className="min-h-screen bg-muted/30 flex">
      <SEO title={`${t("account.title")} | ${t("nav.tagline")}`} description="Gerenciar conta" canonical="/account" />

      {/* Sidebar — mesma ref. da documentação */}
      <aside className="w-64 shrink-0 border-r bg-background/95 sticky top-16 self-start max-h-[calc(100vh-4rem)] overflow-y-auto hidden lg:block">
        <div className="p-4">
          <nav className="space-y-0.5">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 py-1.5 px-2 text-sm font-medium rounded-md transition-colors text-left",
                    activeSection === item.id
                      ? "bg-muted text-primary"
                      : "text-foreground hover:bg-muted hover:text-primary"
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Conteúdo — formato da página de documentação */}
      <div className="flex-1 min-w-0">
        <div className="container max-w-3xl py-8 px-4 lg:px-8">
          {/* Breadcrumb */}
          <nav className="mb-6 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">
              Data Talks
            </Link>
            <span className="mx-2">/</span>
            <span className="text-foreground font-medium">{t("account.title")}</span>
            <span className="mx-2">/</span>
            <span className="text-foreground font-medium">{activeLabel}</span>
          </nav>

          {/* Seletor de seção no mobile (sidebar oculto) */}
          <div className="lg:hidden mb-6">
            <Select value={activeSection} onValueChange={setActiveSection}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Área de conteúdo da seção ativa */}
          <div className="space-y-6">
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

      <AddSourceModal
        open={showAddSourceModal}
        onOpenChange={setShowAddSourceModal}
        onSourceAdded={() => setRefreshTrigger((prev) => prev + 1)}
      />
    </div>
  );
};

export default Account;
