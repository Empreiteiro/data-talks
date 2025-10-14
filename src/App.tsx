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
import ShareAgent from "@/pages/ShareAgent";
import Channels from "@/pages/Channels";
import Notebook from "@/pages/Notebook";
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
  const isNotebookPage = location.pathname.startsWith('/notebook/');

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/share/:token" element={<ShareAgent />} />
          <Route path="/notebook/:id" element={<RequireAuth><Notebook /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/sources" element={<RequireAuth><Sources /></RequireAuth>} />
          <Route path="/agents" element={<RequireAuth><Agents /></RequireAuth>} />
          <Route path="/agents/new" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
          <Route path="/agents/:id" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
          <Route path="/questions" element={<RequireAuth><Questions /></RequireAuth>} />
          <Route path="/alerts" element={<RequireAuth><Alerts /></RequireAuth>} />
          <Route path="/channels" element={<RequireAuth><Channels /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {!isNotebookPage && <Footer />}
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
