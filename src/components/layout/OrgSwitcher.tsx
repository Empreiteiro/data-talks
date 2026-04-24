import { Building2, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";


/**
 * Compact organization picker rendered in the top navigation bar.
 *
 * Hidden when the caller has only one org — there's nothing to switch to and
 * the dropdown just adds noise. Also hidden in guest mode so the "Guest
 * workspace" pseudo-org doesn't appear as a standalone UI element.
 */
export default function OrgSwitcher() {
  const { organizations, activeOrganizationId, switchOrganization, initializing, loginRequired } = useAuth();
  const { t } = useLanguage();
  const [switching, setSwitching] = useState(false);

  if (initializing) return null;
  if (!loginRequired && organizations.length <= 1) return null;
  if (organizations.length === 0) return null;

  const active = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrganizationId || switching) return;
    setSwitching(true);
    try {
      await switchOrganization(orgId);
      // `switchOrganization` reloads the page on success, so we only land
      // here on failure.
    } catch (e) {
      console.error("Failed to switch organization:", e);
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 max-w-[200px]"
          data-walkthrough="org-switcher"
          disabled={switching}
        >
          {switching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Building2 className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate font-medium">{active.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("org.switcher.label") ?? "Organization"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => {
          const isActive = org.id === activeOrganizationId;
          return (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className="cursor-pointer"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={cn("truncate", isActive && "font-medium")}>{org.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{org.role}</div>
                </div>
                {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account?tab=organization" className="cursor-pointer text-sm">
            {t("org.switcher.manage") ?? "Manage organization"}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
