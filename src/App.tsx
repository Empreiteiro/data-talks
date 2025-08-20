import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import NavBar from "@/components/layout/NavBar";
import Footer from "@/components/layout/Footer";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Sources from "@/pages/Sources";
import AgentBriefing from "@/pages/AgentBriefing";
import Questions from "@/pages/Questions";
import Alerts from "@/pages/Alerts";
import Account from "@/pages/Account";
import ShareAgent from "@/pages/ShareAgent";
import Channels from "@/pages/Channels";
import { useAuth } from "@/hooks/useAuth";

const queryClient = new QueryClient();

const RequireAuth = ({ children }: { children: JSX.Element }) => {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
        <div className="min-h-screen flex flex-col">
          <NavBar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Auth />} />
              <Route path="/share/:token" element={<ShareAgent />} />
              <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
              <Route path="/sources" element={<RequireAuth><Sources /></RequireAuth>} />
              <Route path="/agent" element={<RequireAuth><AgentBriefing /></RequireAuth>} />
              <Route path="/questions" element={<RequireAuth><Questions /></RequireAuth>} />
              <Route path="/alerts" element={<RequireAuth><Alerts /></RequireAuth>} />
              <Route path="/channels" element={<RequireAuth><Channels /></RequireAuth>} />
              <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
        </BrowserRouter>
      </TooltipProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
