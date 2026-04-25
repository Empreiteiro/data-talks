import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Combobox for picking an LLM model id.
 *
 * Why a combobox (not a Select): users on OpenAI-compatible proxies
 * routinely need to type model ids that we can't possibly enumerate
 * (custom routes on LiteLLM, fine-tunes, OpenRouter slugs, …). A pure
 * Select traps them. A pure Input loses discoverability for the common
 * case. The combobox is the both-and solution: pick from the curated
 * list, or type anything.
 *
 * Behavior contract:
 *   - `value` is the source of truth. The component never mutates it
 *     except via `onChange`.
 *   - The current `value` is always shown, even if it's not in
 *     `suggestions`. That preserves legacy / user-typed model ids on
 *     re-open without forcing them back into the curated list.
 *   - Typing in the search box is treated as a candidate value; pressing
 *     Enter (or clicking the "Use … as model" row) commits it.
 *   - The optional refresh button hits the parent-supplied
 *     `onRefreshSuggestions` to pull live models from the user's
 *     endpoint. Disabled while in flight.
 *
 * Kept generic so other providers (Anthropic / Google / Claude CLI)
 * can adopt this exact pattern without duplicating the
 * popover+command boilerplate.
 */
export interface ModelComboboxProps {
  value: string;
  onChange: (next: string) => void;
  suggestions: string[];
  /** Shown above the input (e.g. "gpt-4o-mini"). */
  placeholder?: string;
  /** Optional refresh handler — typically fetches `/v1/models` from the user's endpoint. */
  onRefreshSuggestions?: () => void | Promise<void>;
  /** True while `onRefreshSuggestions` is in flight. */
  refreshing?: boolean;
  disabled?: boolean;
  /** ARIA label / data-testid hook. */
  id?: string;
  className?: string;
}

export function ModelCombobox({
  value,
  onChange,
  suggestions,
  placeholder = "Select or type a model…",
  onRefreshSuggestions,
  refreshing = false,
  disabled = false,
  id,
  className,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Always include the current value in the displayed set so the user
  // can see / re-confirm it even when it's not in the curated list.
  const items = useMemo(() => {
    const set = new Set<string>(suggestions);
    if (value) set.add(value);
    return Array.from(set);
  }, [suggestions, value]);

  const trimmedSearch = search.trim();
  // If the user typed something that doesn't match any suggestion,
  // offer it as a "Use X as model" row — Enter on that row commits it.
  const showCustomRow =
    trimmedSearch.length > 0 &&
    !items.some((m) => m.toLowerCase() === trimmedSearch.toLowerCase());

  const commit = (next: string) => {
    onChange(next);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="flex-1 justify-between font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command
            // Custom filter: case-insensitive substring on the model id
            // itself. cmdk's default scorer is fine for short ids but
            // tends to over-rank prefix matches; substring matches the
            // user's mental model better for things like "4o" → "gpt-4o-mini".
            filter={(itemValue, query) =>
              itemValue.toLowerCase().includes(query.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput
              placeholder="Filter or type a model id…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              {items.length > 0 && (
                <CommandGroup heading="Models">
                  {items.map((m) => (
                    <CommandItem
                      key={m}
                      value={m}
                      onSelect={() => commit(m)}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          m === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{m}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {showCustomRow && (
                <CommandGroup heading="Custom">
                  <CommandItem
                    value={`__custom__:${trimmedSearch}`}
                    onSelect={() => commit(trimmedSearch)}
                    className="cursor-pointer"
                  >
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    <span className="truncate">Use “{trimmedSearch}” as model</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {onRefreshSuggestions && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void onRefreshSuggestions()}
          disabled={disabled || refreshing}
          title="Fetch models from endpoint"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
