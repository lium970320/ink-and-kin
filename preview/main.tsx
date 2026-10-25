import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import App from "@/App";
import Landing from "@/pages/Landing";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";
const client = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
const api = trpc.createClient({links:[httpBatchLink({url:"/api/trpc",transformer:superjson})]});
function Preview(){return location.pathname==="/welcome"?<ThemeProvider defaultTheme="light"><LocaleProvider><TooltipProvider><Landing/></TooltipProvider></LocaleProvider></ThemeProvider>:<App/>;}
createRoot(document.getElementById("root")!).render(<trpc.Provider client={api} queryClient={client}><QueryClientProvider client={client}><Preview/></QueryClientProvider></trpc.Provider>);
