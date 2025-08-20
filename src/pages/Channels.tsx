import { SEO } from "@/components/SEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Settings, Slack, Smartphone } from "lucide-react";
import { useState } from "react";

const Channels = () => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [connecting, setConnecting] = useState<string | null>(null);

  const handleConnect = async (channel: string) => {
    setConnecting(channel);
    
    // Simulate connection process
    setTimeout(() => {
      toast({
        title: `${channel} Connection`,
        description: `${channel} integration will be available soon.`,
      });
      setConnecting(null);
    }, 2000);
  };

  const channels = [
    {
      id: "whatsapp",
      name: t('channels.whatsapp.name'),
      description: t('channels.whatsapp.description'),
      icon: MessageSquare,
      status: "coming-soon",
      color: "bg-green-500"
    },
    {
      id: "slack",
      name: t('channels.slack.name'), 
      description: t('channels.slack.description'),
      icon: Slack,
      status: "coming-soon",
      color: "bg-purple-500"
    },
    {
      id: "telegram",
      name: t('channels.telegram.name'),
      description: t('channels.telegram.description'),
      icon: Smartphone,
      status: "coming-soon", 
      color: "bg-blue-500"
    }
  ];

  return (
    <>
      <SEO 
        title="Channels - Connect Communication Platforms"
        description="Connect and manage your communication channels including WhatsApp, Slack, and Telegram integrations."
      />
      
      <div className="container mx-auto p-6 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t('channels.title')}</h1>
          <p className="text-muted-foreground">
            {t('channels.subtitle')}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => {
            const Icon = channel.icon;
            const isConnecting = connecting === channel.id;
            
            return (
              <Card key={channel.id} className="relative overflow-hidden flex flex-col h-full">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${channel.color} text-white`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{channel.name}</CardTitle>
                        <Badge variant="secondary" className="mt-1">
                          {channel.status === "coming-soon" ? t('channels.comingSoon') : t('channels.available')}
                        </Badge>
                      </div>
                    </div>
                    <Settings className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>
                
                <CardContent className="flex-1 flex flex-col space-y-4">
                  <CardDescription className="text-sm leading-relaxed flex-1">
                    {channel.description}
                  </CardDescription>
                  
                  <Button 
                    onClick={() => handleConnect(channel.id)}
                    disabled={isConnecting}
                    className="w-full mt-auto"
                    variant={channel.status === "connected" ? "secondary" : "default"}
                  >
                    {isConnecting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        {t('channels.connecting')}
                      </>
                    ) : channel.status === "connected" ? (
                      t('channels.connected')
                    ) : (
                      channel.id === "whatsapp" ? t('channels.connectWhatsApp') :
                      channel.id === "slack" ? t('channels.connectSlack') :
                      channel.id === "telegram" ? t('channels.connectTelegram') :
                      `Connect ${channel.name}`
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-lg">{t('channels.needMoreIntegrations.title')}</CardTitle>
            <CardDescription>
              {t('channels.needMoreIntegrations.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline">
              {t('channels.requestIntegration')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Channels;