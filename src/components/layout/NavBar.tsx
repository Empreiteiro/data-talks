import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const NavBar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <nav className="container flex items-center justify-between h-16">
        <Link to="/" className="font-semibold tracking-tight">
          Converse com seus dados
        </Link>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">Dashboard</Link>
              <Link to="/sources" className="text-sm text-muted-foreground hover:text-foreground">Fontes</Link>
              <Link to="/questions" className="text-sm text-muted-foreground hover:text-foreground">Perguntas</Link>
              <Link to="/alerts" className="text-sm text-muted-foreground hover:text-foreground">Alertas</Link>
              <Link to="/account" className="text-sm text-muted-foreground hover:text-foreground">Conta</Link>
              <Button variant="secondary" onClick={handleLogout}>Sair</Button>
            </>
          ) : (
            <Button asChild>
              <Link to="/login">Começar agora</Link>
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
};

export default NavBar;
