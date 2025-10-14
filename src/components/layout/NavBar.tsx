import { Button } from "@/components/ui/button";
import { useLanguage, Language } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { Settings, Globe } from "lucide-react";
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
  const { t, language, setLanguage } = useLanguage();
  
  const languages = [
    { code: 'en' as Language, name: 'English', flag: '🇺🇸' },
    { code: 'pt' as Language, name: 'Português', flag: '🇧🇷' },
  ];

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <nav className="container flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label={t('nav.tagline')}>
          <span role="img" aria-label="Logo gráfico de crescimento" className="text-xl leading-none">📈</span>
          <span className="hidden sm:inline">{t('nav.tagline')}</span>
        </Link>
        
        {/* Link de Preços no Centro */}
        {!user && (
          <div className="hidden md:flex items-center">
            <Button asChild variant="ghost" size="sm">
              <Link to="/pricing">{t('pricing.title')}</Link>
            </Button>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Button asChild size="sm">
                <Link to="/dashboard">{t('nav.dashboard')}</Link>
              </Button>
              
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
                    <Link to="/account" className="cursor-pointer">
                      {t('settings.manageSubscription')}
                    </Link>
                  </DropdownMenuItem>
                  
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
                  <Button variant="ghost" size="sm">
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
              
              <Button asChild>
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
