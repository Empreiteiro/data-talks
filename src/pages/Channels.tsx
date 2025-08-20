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
      name: "WhatsApp",
      description: "Connect your WhatsApp Business API to receive and respond to messages",
      icon: MessageSquare,
      status: "coming-soon",
      color: "bg-green-500"
    },
    {
      id: "slack",
      name: "Slack", 
      description: "Integrate with Slack to manage conversations and notifications",
      icon: Slack,
      status: "coming-soon",
      color: "bg-purple-500"
    },
    {
      id: "telegram",
      name: "Telegram",
      description: "Connect Telegram bot for automated customer support",
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
          <h1 className="text-3xl font-bold tracking-tight">Channels</h1>
          <p className="text-muted-foreground">
            Connect and manage your communication channels to streamline customer interactions
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
                          {channel.status === "coming-soon" ? "Coming Soon" : "Available"}
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
                        Connecting...
                      </>
                    ) : channel.status === "connected" ? (
                      "Connected"
                    ) : (
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
            <CardTitle className="text-lg">Need More Integrations?</CardTitle>
            <CardDescription>
              We're constantly adding new channel integrations. Contact our support team to request specific platforms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline">
              Request Integration
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Channels;