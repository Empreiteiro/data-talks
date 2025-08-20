import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabaseClient } from "@/services/supabaseClient";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

const Dashboard = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  
  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => supabaseClient.listSources()
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => supabaseClient.listAgents()
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => supabaseClient.listAlerts()
  });

  return (
    <main className="container py-10">
      <SEO title={`${t('dashboard.title')} | ${t('nav.tagline')}`} description="Visão geral das fontes, perguntas e alertas" canonical="/dashboard" />
      <h1 className="text-3xl font-semibold mb-6">{t('dashboard.title')}</h1>
      <div className="space-y-6">
                 {/* Primeira linha - 4 blocos */}
         <div className="grid gap-6 md:grid-cols-4">
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.dataSources')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{sources.length} {t('dashboard.connectedSources')}</p>
               <Button className="mt-auto self-start" onClick={() => navigate('/sources')}>{t('dashboard.addSource')}</Button>
             </CardContent>
           </Card>
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.agentConfig')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{t('dashboard.agentConfigDesc')}</p>
               <Button className="mt-auto self-start" variant="secondary" onClick={() => navigate('/agent')}>{t('dashboard.configureAgent')}</Button>
             </CardContent>
           </Card>
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.questionsAnswers')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{agents.length} {t('dashboard.activeAgents')}</p>
               <Button className="mt-auto self-start" variant="secondary" onClick={() => navigate('/questions')}>{t('dashboard.newQuestion')}</Button>
             </CardContent>
           </Card>
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.alerts')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{alerts.length} {t('dashboard.configuredAlerts')}</p>
               <Button className="mt-auto self-start" variant="secondary" onClick={() => navigate('/alerts')}>{t('dashboard.createAlert')}</Button>
             </CardContent>
           </Card>
         </div>
        
                 {/* Segunda linha - 3 blocos + 1 bloco invisível */}
         <div className="grid gap-6 md:grid-cols-4">
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.channelConfig')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{t('dashboard.channelConfigDesc')}</p>
               <Button className="mt-auto self-start" variant="outline" onClick={() => navigate('/channels')}>{t('dashboard.configureChannels')}</Button>
             </CardContent>
           </Card>
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.dataExplore')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{t('dashboard.dataExploreDesc')}</p>
               <Button className="mt-auto self-start" variant="outline" disabled>{t('dashboard.comingSoon')}</Button>
             </CardContent>
           </Card>
           <Card className="shadow-sm h-full flex flex-col min-h-[280px]">
             <CardHeader>
               <CardTitle>{t('dashboard.autoML')}</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 flex flex-col gap-4">
               <p className="text-muted-foreground flex-1">{t('dashboard.autoMLDesc')}</p>
               <Button className="mt-auto self-start" variant="outline" disabled>{t('dashboard.comingSoon')}</Button>
             </CardContent>
           </Card>
           {/* Bloco invisível para manter o grid */}
           <div className="hidden md:block"></div>
         </div>
      </div>
    </main>
  );
};

export default Dashboard;
