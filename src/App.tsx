import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import Index from "./pages/Index";
import Pricing from "./pages/Pricing";
import NotFound from "./pages/NotFound";
import NavBar from "@/components/layout/NavBar";
import Footer from "@/components/layout/Footer";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Sources from "@/pages/Sources";
import AgentBriefing from "@/pages/AgentBriefing";
import Questions from "@/pages/Questions";
import Alerts from "@/pages/Alerts";
import Agents from "@/pages/Agents";
import Account from "@/pages/Account";
import Workspace from "@/pages/Workspace";
import Users from "@/pages/Users";
import WorkspaceAccess from "@/pages/WorkspaceAccess";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient();

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
};

const AppContent = () => {
  const location = useLocation();
  const isWorkspacePage = location.pathname.startsWith('/workspace/');
  const isIndexPage = location.pathname === '/';

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/workspace/:id" element={<RequireAuth><Workspace /></RequireAuth>} />
          {/* Redirect old notebook URLs to workspace */}
          <Route path="/notebook/:id" element={<RequireAuth><Workspace /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/sources" element={<RequireAuth><Sources /></RequireAuth>} />
          <Route path="/agents" element={<RequireAuth><Agents /></RequireAuth>} />
          <Route path="/agents/new" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
          <Route path="/agents/:id" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
          <Route path="/questions" element={<RequireAuth><Questions /></RequireAuth>} />
          <Route path="/alerts" element={<RequireAuth><Alerts /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/users" element={<RequireAuth><Users /></RequireAuth>} />
          <Route path="/workspace-access" element={<RequireAuth><WorkspaceAccess /></RequireAuth>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {!isWorkspacePage && !isIndexPage && <Footer />}
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
