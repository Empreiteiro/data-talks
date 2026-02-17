import Footer from "@/components/layout/Footer";
import { LogsPanel } from "@/components/LogsPanel";
import NavBar from "@/components/layout/NavBar";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import Account from "@/pages/Account";
import AgentBriefing from "@/pages/AgentBriefing";
import Alerts from "@/pages/Alerts";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import DocIndex from "@/pages/docs/DocIndex";
import DocLayout from "@/pages/docs/DocLayout";
import DocTopicPage from "@/pages/docs/DocTopicPage";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Workspace from "@/pages/Workspace";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { isAuthenticated, initializing, loginRequired } = useAuth();
  if (initializing) return null;
  if (!loginRequired) return children;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
};

const AppContent = () => {
  const location = useLocation();
  const isWorkspacePage = location.pathname.startsWith('/workspace/');
  const isDashboardPage = location.pathname.startsWith('/dashboard/');
  const isIndexPage = location.pathname === '/';

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/workspace/:id" element={<RequireAuth><Workspace /></RequireAuth>} />
          {/* Redirect old notebook URLs to workspace */}
          <Route path="/notebook/:id" element={<RequireAuth><Workspace /></RequireAuth>} />
          <Route path="/dashboard/:id" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/agents/new" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
          <Route path="/agents/:id" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
          <Route path="/alerts" element={<RequireAuth><Alerts /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/flows" element={<DocLayout />}>
            <Route index element={<DocIndex />} />
            <Route path=":topic" element={<DocTopicPage />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {!isWorkspacePage && !isDashboardPage && !isIndexPage && <Footer />}
      {!isWorkspacePage && <LogsPanel />}
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
