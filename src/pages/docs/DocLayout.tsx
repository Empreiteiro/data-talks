import { SEO } from "@/components/SEO";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { filterToc, getDocStructure } from "./docStructure";

export default function DocLayout() {
  const { t, language } = useLanguage();
  const isPt = language === "pt";
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const structure = useMemo(() => getDocStructure(isPt), [isPt]);
  const filteredToc = useMemo(() => filterToc(structure, search), [structure, search]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filteredToc.length > 0) {
      navigate(`/flows/${filteredToc[0].id}`);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex">
      <SEO title={t("doc.title")} description={t("doc.subtitle")} />

      <aside className="w-64 shrink-0 border-r bg-background/95 sticky top-16 min-h-[calc(100vh-4rem)] overflow-y-auto hidden lg:block">
        <div className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={t("doc.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-9 h-9"
              aria-label={t("doc.searchPlaceholder")}
            />
          </div>
          <nav className="space-y-0.5">
            {filteredToc.map((sec) => (
              <div key={sec.id}>
                <NavLink
                  to={`/flows/${sec.id}`}
                  className={({ isActive }) =>
                    `block py-1.5 px-2 text-sm font-medium rounded-md hover:bg-muted hover:text-primary ${isActive ? "bg-muted text-primary" : "text-foreground"}`
                  }
                >
                  {sec.title}
                </NavLink>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
