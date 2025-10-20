import { Button } from "@/components/ui/button";
import { useLanguage, Language } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { Link } from "react-router-dom";
import { Settings, Globe, Linkedin, Mail } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

const NavBar = () => {
  const { user, logout } = useAuth();
  const { data: userRole } = useUserRole(user?.id);
  const { t, language, setLanguage } = useLanguage();
  
  const languages = [
    { code: 'en' as Language, name: 'English', flag: '🇺🇸' },
    { code: 'pt' as Language, name: 'Português', flag: '🇧🇷' },
  ];

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
      <nav className="w-full flex items-center justify-between h-16 px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label={t('nav.tagline')}>
          <span role="img" aria-label="Logo gráfico de crescimento" className="text-xl leading-none">📈</span>
          <span className="hidden sm:inline">{t('nav.tagline')}</span>
        </Link>
        
        <div className="flex items-center gap-4 ml-auto">
          {/* Links principais */}
          {!user && (
            <>
              <Button asChild variant="ghost" size="sm" className="text-sm font-normal">
                <Link to="/pricing">{t('pricing.title')}</Link>
              </Button>
            </>
          )}
          
          {/* Social Links - sempre visível para não-logados */}
          {!user && (
            <>
              <a
                href="mailto:democh@oriontech.me"
                className="text-muted-foreground hover:text-foreground transition-colors p-2"
                aria-label="Email"
              >
                <Mail className="h-4 w-4" />
              </a>
              <a
                href="https://www.linkedin.com/in/lucas-democh-goularte-8b290356/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors p-2"
                aria-label="LinkedIn"
              >
                <Linkedin className="h-4 w-4" />
              </a>
            </>
          )}
          
          {/* Language & Auth */}
          {user ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{t('settings.title')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard" className="cursor-pointer">
                      Dashboard (deprecated)
                    </Link>
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem asChild>
                    <Link to="/account" className="cursor-pointer">
                      {t('settings.manageSubscription')}
                    </Link>
                  </DropdownMenuItem>
                  
                  {userRole === 'admin' && (
                    <>
                      <DropdownMenuItem asChild>
                        <Link to="/users" className="cursor-pointer">
                          {t('settings.users')}
                        </Link>
                      </DropdownMenuItem>
                      
                      <DropdownMenuItem asChild>
                        <Link to="/workspace-access" className="cursor-pointer">
                          {t('settings.workspaceAccess')}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    {t('settings.language')}
                  </DropdownMenuLabel>
                  
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={language === lang.code ? "bg-accent" : ""}
                    >
                      <span className="mr-2">{lang.flag}</span>
                      {lang.name}
                    </DropdownMenuItem>
                  ))}
                  
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <Globe className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={language === lang.code ? "bg-accent" : ""}
                    >
                      <span className="mr-2">{lang.flag}</span>
                      {lang.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <Button asChild className="rounded-full">
                <Link to="/login">{t('nav.getStarted')}</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

export default NavBar;
