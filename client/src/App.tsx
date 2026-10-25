import { Suspense, lazy, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoader from "./components/PageLoader";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import HomePage from "./pages/HomePage";

const Login = lazy(() => import("./pages/Login"));
const Settings = lazy(() => import("./pages/Settings"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Diary = lazy(() => import("./pages/Diary"));
const Scenes = lazy(() => import("./pages/Scenes"));
const Roleplay = lazy(() => import("./pages/Roleplay"));
const PersonaEdit = lazy(() => import("./pages/PersonaEdit"));
const Upload = lazy(() => import("./pages/Upload"));
const Chat = lazy(() => import("./pages/Chat"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Questionnaire = lazy(() => import("./pages/Questionnaire"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  const [location] = useLocation();
  return (
    <Suspense fallback={<PageLoader />}>
      <div key={location} className="route-transition"><Switch>
        <Route path="/" component={HomePage} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/persona/new/questionnaire" component={Questionnaire} />
        <Route path="/login" component={Login} />
        <Route path="/settings" component={Settings} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/diary/:id?" component={Diary} />
        <Route path="/diary" component={Diary} />
        <Route path="/scenes/:id" component={Scenes} />
        <Route path="/roleplay" component={Roleplay} />
        <Route path="/persona/:id/edit" component={PersonaEdit} />
        <Route path="/upload/:id" component={Upload} />
        <Route path="/chat/:id" component={Chat} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch></div>
    </Suspense>
  );
}

function useClickRipple() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.("button");
      if (!target || (target as HTMLButtonElement).disabled) return;
      if (!String(target.className).includes("bg-primary")) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.2;
      const span = document.createElement("span");
      span.className = "ripple-ink";
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      const cs = getComputedStyle(target);
      if (cs.position === "static") target.style.position = "relative";
      if (cs.overflow !== "hidden") target.style.overflow = "hidden";
      target.appendChild(span);
      setTimeout(() => span.remove(), 600);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
}

function App() {
  useClickRipple();
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <LocaleProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
