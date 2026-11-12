import { motion, useReducedMotion } from "framer-motion";
import { EASE_OUT_EXPO } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { Home } from "lucide-react";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();

  return (
    <main className="min-h-dvh relative flex items-center justify-center overflow-hidden bg-background p-4">
      <div aria-hidden="true" className="gradient-mesh-bg" />
      <motion.div initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: EASE_OUT_EXPO }}
        className="warm-card warm-card-static relative z-10 w-full max-w-md rounded-3xl border border-border/70 p-8 text-center sm:p-10">
        <div className="mb-5 flex justify-center">
          <Wordmark />
        </div>
        <div className="font-display text-7xl font-semibold text-foreground mb-6">
          404<span className="text-cinnabar">.</span>
        </div>

        <h1 className="page-title mb-3">
          {t("errors.notFoundHeading")}
        </h1>

        <p className="text-muted-foreground mb-8 leading-relaxed text-[0.9375rem]">
          {t("errors.notFoundBodyLine1")}
          <br />
          {t("errors.notFoundBodyLine2")}
        </p>

        <hr className="rule mx-auto mb-8 w-16" />

        <Button onClick={() => setLocation("/")} className="rounded-md px-8 h-11 gap-2">
          <Home className="w-4 h-4" />
          {t("errors.backHome")}
        </Button>
      </motion.div>
    </main>
  );
}
