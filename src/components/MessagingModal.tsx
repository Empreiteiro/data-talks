/**
 * MessagingModal — unified channel selector for WhatsApp, Slack, and Telegram.
 * Shows a channel picker, then renders the specific modal for the selected channel.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Hash, MessageCircle, Send } from "lucide-react";
import { WhatsAppModal } from "@/components/WhatsAppModal";
import { SlackModal } from "@/components/SlackModal";
import { TelegramModal } from "@/components/TelegramModal";

interface MessagingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

const channels = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, description: "Connect via WhatsApp Business API" },
  { id: "slack", label: "Slack", icon: Hash, description: "Connect a Slack workspace channel" },
  { id: "telegram", label: "Telegram", icon: Send, description: "Connect a Telegram bot" },
] as const;

type ChannelId = typeof channels[number]["id"];

export function MessagingModal({ open, onOpenChange, agentId }: MessagingModalProps) {
  const [selectedChannel, setSelectedChannel] = useState<ChannelId | null>(null);

  const handleClose = (v: boolean) => {
    if (!v) setSelectedChannel(null);
    onOpenChange(v);
  };

  // If a channel is selected, render its specific modal
  if (selectedChannel === "whatsapp") {
    return <WhatsAppModal open={open} onOpenChange={handleClose} agentId={agentId} />;
  }
  if (selectedChannel === "slack") {
    return <SlackModal open={open} onOpenChange={handleClose} agentId={agentId} />;
  }
  if (selectedChannel === "telegram") {
    return <TelegramModal open={open} onOpenChange={handleClose} agentId={agentId} />;
  }

  // Channel selector
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Messaging</DialogTitle>
          <DialogDescription>Select a messaging channel to configure.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          {channels.map((ch) => (
            <Card
              key={ch.id}
              className="p-4 cursor-pointer hover:shadow-md hover:border-blue-400 transition-all"
              onClick={() => setSelectedChannel(ch.id)}
            >
              <div className="flex items-center gap-3">
                <ch.icon className="h-6 w-6 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{ch.label}</p>
                  <p className="text-xs text-muted-foreground">{ch.description}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
