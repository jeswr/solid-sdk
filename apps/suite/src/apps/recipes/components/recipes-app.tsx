// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  DAYS,
  formatDuration,
  importRecipe,
  type RecipeData,
  type RecipeRecord,
  recipeSubject,
} from "@jeswr/solid-recipe";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Label,
  LoadingSkeleton,
  Textarea,
} from "@jeswr/suite-ui";
import {
  BookOpen,
  CalendarDays,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Heart,
  Plus,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { filterRecipes, weekDays } from "../lib/recipes";
import { RecipesProvider, useRecipes } from "../state/recipes-context";
import { RecipeDetail } from "./recipe-detail";
import { RecipeForm } from "./recipe-form";

export function RecipesApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <Session />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
function Session() {
  const session = usePodSessionState();
  if (session.status === "error") return <ErrorState error="unreachable" />;
  if (session.status !== "ready") return <LoadingSkeleton label="Opening Recipes" preset="grid" />;
  return (
    <RecipesProvider
      key={`${session.session.webId}:${session.session.storageUrl}`}
      session={session.session}
    >
      <Workspace />
    </RecipesProvider>
  );
}
function Workspace() {
  const { recipes, plans, skipped, status, pending, actions } = useRecipes();
  const connection = useConnectionState();
  const offline = connection !== "online";
  const [tab, setTab] = useState<"box" | "plan">("box");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [favourites, setFavourites] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<{ data?: RecipeData; url?: string }>();
  const [importing, setImporting] = useState(false);
  const [source, setSource] = useState("");
  const [importError, setImportError] = useState("");
  const [week, setWeek] = useState(0);
  const dates = weekDays(new Date(), week);
  const first = dates[0] as string;
  const plan = plans.find((item) => item.data.name === first);
  const record = recipes.find((item) => item.url === selected);
  const shown = filterRecipes(recipes, query, category, cuisine, favourites);
  const clear = () => {
    setQuery("");
    setCategory("");
    setCuisine("");
    setFavourites(false);
  };
  const chooseTab = (next: "box" | "plan") => {
    setTab(next);
    setSelected(undefined);
  };
  return (
    <AppFrame
      app="recipes"
      context={<span>{recipes.length} recipes</span>}
      sidebar={
        <nav className="recipes-nav" aria-label="Recipes views">
          <p className="recipes-eyebrow">Made for your table</p>
          <Button
            variant={tab === "box" ? "secondary" : "ghost"}
            onClick={() => chooseTab("box")}
            aria-pressed={tab === "box"}
          >
            <BookOpen size={18} aria-hidden="true" />
            Recipe box
          </Button>
          <Button
            variant={tab === "plan" ? "secondary" : "ghost"}
            onClick={() => chooseTab("plan")}
            aria-pressed={tab === "plan"}
          >
            <CalendarDays size={18} aria-hidden="true" />
            Meal plan
          </Button>
          <p className="recipes-muted">
            Your favourites, your way.
            <br />
            Saved in your pod.
          </p>
        </nav>
      }
      actions={
        <>
          <Button variant="outline" onClick={() => setImporting(true)} disabled={offline}>
            <Upload size={16} aria-hidden="true" />
            Import
          </Button>
          <Button onClick={() => setEditing({})} disabled={offline}>
            <Plus size={16} aria-hidden="true" />
            New recipe
          </Button>
        </>
      }
    >
      <div className="recipes-app">
        <nav className="recipes-actions recipes-view-switch" aria-label="Recipe workspace">
          <Button
            variant={tab === "box" ? "secondary" : "ghost"}
            aria-pressed={tab === "box" && !record}
            onClick={() => chooseTab("box")}
          >
            Browse recipes
          </Button>
          <Button
            variant={tab === "plan" ? "secondary" : "ghost"}
            aria-pressed={tab === "plan" && !record}
            onClick={() => chooseTab("plan")}
          >
            Plan this week
          </Button>
        </nav>
        {offline && (
          <p role="status" className="recipes-notice">
            You're offline. Keep cooking with recipes already open. Reconnect before saving changes.
          </p>
        )}
        {pending > 0 && (
          <p role="status" className="recipes-notice">
            Saving {pending === 1 ? "your change" : `${pending} changes`}…
          </p>
        )}
        {status === "ready" && skipped.length > 0 && (
          <p role="status" className="recipes-muted">
            {skipped.length === 1
              ? "One file could not be read as a recipe or meal plan. Your other recipes are ready."
              : `${skipped.length} files could not be read as recipes or meal plans. Your other recipes are ready.`}
          </p>
        )}
        {status === "loading" ? (
          <LoadingSkeleton preset="grid" label="Loading your recipes" />
        ) : status === "error" ? (
          <ErrorState
            error="unreachable"
            actions={{
              retry: () => {
                void actions.refresh();
              },
            }}
          />
        ) : record ? (
          <RecipeDetail
            key={record.url}
            record={record}
            disabled={offline || record.url.startsWith("local:")}
            onBack={() => setSelected(undefined)}
            onEdit={() => setEditing({ data: record.data, url: record.url })}
            onFavourite={() => actions.favourite(record.url)}
          />
        ) : tab === "box" ? (
          <>
            <header className="recipes-header">
              <p className="recipes-eyebrow">A little inspiration for every day</p>
              <AppHeading>Your recipe box</AppHeading>
              <p className="recipes-muted">Good food, gathered in one place.</p>
            </header>
            <div className="recipes-filters">
              <div>
                <Label htmlFor="recipe-search">Search recipes</Label>
                <Input
                  id="recipe-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, ingredient or tag"
                />
              </div>
              <div>
                <Label htmlFor="recipe-category-filter">Category</Label>
                <select
                  id="recipe-category-filter"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">All categories</option>
                  {[...new Set(recipes.map((item) => item.data.category).filter(Boolean))]
                    .sort()
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </div>
              <div>
                <Label htmlFor="recipe-cuisine-filter">Cuisine</Label>
                <select
                  id="recipe-cuisine-filter"
                  value={cuisine}
                  onChange={(event) => setCuisine(event.target.value)}
                >
                  <option value="">All cuisines</option>
                  {[...new Set(recipes.map((item) => item.data.cuisine).filter(Boolean))]
                    .sort()
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </div>
              <Button
                variant={favourites ? "secondary" : "outline"}
                aria-pressed={favourites}
                onClick={() => setFavourites((value) => !value)}
              >
                <Heart size={16} aria-hidden="true" />
                Favourites
              </Button>
              {(query || category || cuisine || favourites) && (
                <Button variant="ghost" onClick={clear}>
                  Clear filters
                </Button>
              )}
            </div>
            {!shown.length ? (
              <EmptyState
                title={recipes.length ? "No recipes match" : "Start your recipe box"}
                body={
                  recipes.length
                    ? "Try another search or clear your filters."
                    : "Save a family favourite or import a recipe you love."
                }
                variant={recipes.length ? "filtered-empty" : "first-use"}
                primaryAction={
                  <Button
                    disabled={offline && !recipes.length}
                    onClick={() => (recipes.length ? clear() : setEditing({}))}
                  >
                    {recipes.length ? "Clear filters" : "Add a recipe"}
                  </Button>
                }
              />
            ) : (
              <div className="recipes-grid">
                {shown.map((item) => (
                  <RecipeCard
                    key={item.url}
                    record={item}
                    onOpen={() => setSelected(item.url)}
                    onFavourite={() => actions.favourite(item.url)}
                    disabled={offline || item.url.startsWith("local:")}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <header className="recipes-header">
              <p className="recipes-eyebrow">A week of good things</p>
              <AppHeading>Your meal plan</AppHeading>
              <p className="recipes-muted">
                Choose one recipe for each day. Leave room for leftovers.
              </p>
            </header>
            <div className="recipes-week">
              <IconButton label="Previous week" onClick={() => setWeek((value) => value - 1)}>
                <ChevronLeft aria-hidden="true" />
              </IconButton>
              <h2>
                Week of{" "}
                {new Date(`${first}T12:00:00`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </h2>
              <IconButton label="Next week" onClick={() => setWeek((value) => value + 1)}>
                <ChevronRight aria-hidden="true" />
              </IconButton>
              <Button variant="ghost" onClick={() => setWeek(0)}>
                This week
              </Button>
            </div>
            {!recipes.length ? (
              <EmptyState
                title="Your week starts with a recipe"
                body="Add a recipe to your box, then choose what to cook."
                primaryAction={
                  <Button disabled={offline} onClick={() => setEditing({})}>
                    Add a recipe
                  </Button>
                }
              />
            ) : (
              <div className="recipes-plan">
                {DAYS.map((day, index) => {
                  const chosen = recipes.find(
                    (item) => recipeSubject(item.url) === plan?.data[day],
                  );
                  return (
                    <section key={day} className="recipes-day">
                      <Label htmlFor={`plan-${day}`}>
                        <span>{day}</span>
                        <small>
                          {new Date(`${dates[index]}T12:00:00`).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </small>
                      </Label>
                      <select
                        id={`plan-${day}`}
                        disabled={offline}
                        value={plan?.data[day] ?? ""}
                        onChange={(event) =>
                          actions.assign(first, day, event.target.value || undefined)
                        }
                      >
                        <option value="">Leave open</option>
                        {plan?.data[day] && !chosen && (
                          <option value={plan.data[day]}>Recipe unavailable</option>
                        )}
                        {recipes
                          .filter((item) => !item.url.startsWith("local:"))
                          .map((item) => (
                            <option key={item.url} value={recipeSubject(item.url)}>
                              {item.data.name}
                            </option>
                          ))}
                      </select>
                      {chosen ? (
                        <Button variant="ghost" onClick={() => setSelected(chosen.url)}>
                          View recipe
                        </Button>
                      ) : (
                        <p className="recipes-muted">Something spontaneous?</p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      {editing && (
        <RecipeForm
          disabled={offline}
          initial={editing.data}
          onClose={() => setEditing(undefined)}
          onSave={(data) => {
            if (offline) return;
            actions.save(data, editing.url);
            setEditing(undefined);
          }}
        />
      )}
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent className="recipes-import">
          <DialogHeader>
            <DialogTitle>Bring a recipe home</DialogTitle>
            <DialogDescription>
              Paste a page's HTML source or Recipe JSON-LD. Nothing in the page will run.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const data = importRecipe(source);
                setImporting(false);
                setEditing({ data });
                setImportError("");
              } catch (error) {
                setImportError(
                  error instanceof Error ? error.message : "Couldn't import this recipe",
                );
              }
            }}
          >
            <Label htmlFor="recipe-import-source">Page source or JSON-LD</Label>
            <Textarea
              id="recipe-import-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              rows={12}
              required
            />
            <p className="recipes-muted">
              To copy page source, open the recipe page, choose “View page source”, then copy and
              paste it here. Direct URL import is not available in this first cut.
            </p>
            {importError && <p role="alert">{importError}</p>}
            <Button type="submit">Review recipe</Button>
          </form>
        </DialogContent>
      </Dialog>
    </AppFrame>
  );
}
function RecipeCard({
  record,
  onOpen,
  onFavourite,
  disabled,
}: {
  record: RecipeRecord;
  onOpen: () => void;
  onFavourite: () => void;
  disabled: boolean;
}) {
  const { data } = record;
  const [failedImage, setFailedImage] = useState<string>();
  return (
    <article className="recipes-card">
      <div className="recipes-card-image">
        {data.image && failedImage !== data.image ? (
          // biome-ignore lint/performance/noImgElement: user-supplied recipe artwork cannot use a server image proxy.
          <img
            src={data.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedImage(data.image)}
          />
        ) : (
          <ChefHat size={48} strokeWidth={1} aria-hidden="true" />
        )}
        <IconButton
          label={`${data.favourite ? "Unfavourite" : "Favourite"} ${data.name}`}
          aria-pressed={data.favourite ?? false}
          onClick={onFavourite}
          disabled={disabled}
        >
          <Heart size={18} fill={data.favourite ? "currentColor" : "none"} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="recipes-card-body">
        <p className="recipes-eyebrow">
          {data.category || "Recipe"}
          {data.cuisine && ` · ${data.cuisine}`}
        </p>
        <h2>
          <Button variant="link" onClick={onOpen}>
            {data.name}
          </Button>
        </h2>
        <p className="recipes-muted">{data.description || "A recipe to make your own."}</p>
        <div className="recipes-card-meta">
          <span>{formatDuration(data.totalTime) || "Take your time"}</span>
          <span>{data.recipeYield || "Your table"}</span>
        </div>
      </div>
    </article>
  );
}
