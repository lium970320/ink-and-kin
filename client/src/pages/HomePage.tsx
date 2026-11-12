import { useAuth } from "@/_core/hooks/useAuth";
import { EASE_OUT_EXPO } from "@/components/ui/motion";
import { AnimatePresence, motion } from "framer-motion";
import { Leaf } from "lucide-react";
import Landing from "./Landing";
import Lobby from "./Lobby";

export default function HomePage() {
  const { isAuthenticated, loading } = useAuth();

  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="auth-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          className="min-h-screen bg-background flex flex-col items-center justify-center relative overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute w-72 h-72 rounded-full bg-primary/[0.06] blur-3xl"
          />
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
            className="relative flex flex-col items-center gap-3.5"
          >
            <div className="relative flex items-center justify-center">
              <motion.span
                aria-hidden="true"
                animate={{ scale: [1, 1.22, 1], opacity: [0.35, 0.08, 0.35] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-2xl bg-primary/20"
              />
              <div className="relative w-12 h-12 rounded-2xl bg-card/90 border border-border/70 shadow-sm backdrop-blur-md flex items-center justify-center">
                <Leaf className="w-5 h-5 text-primary" />
              </div>
            </div>
            <span className="text-xs font-medium tracking-[0.18em] uppercase text-muted-foreground/75">
              书中人
            </span>
          </motion.div>
        </motion.div>
      ) : (
        <motion.div
          key={isAuthenticated ? "lobby" : "landing"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
        >
          {isAuthenticated ? <Lobby /> : <Landing />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
