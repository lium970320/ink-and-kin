import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { X, GraduationCap, Heart, Sunrise, Sparkles, Feather } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MotionModal, SPRING_GENTLE, SPRING_SILKY } from "@/components/ui/motion";
import { toast } from "sonner";

interface Props {
  personaId: number;
  personaName: string;
  open: boolean;
  onClose: () => void;
}

export default function GraduationModal({ personaId, personaName, open, onClose }: Props) {
  const [phase, setPhase] = useState<"suggest" | "letter">("suggest");
  const [letter, setLetter] = useState("");

  useEffect(() => {
    setPhase("suggest");
    setLetter("");
  }, [personaId]);

  const graduateMutation = trpc.persona.graduate.useMutation({
    onSuccess: (data) => {
      setLetter(data.farewellLetter);
      setPhase("letter");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const declineMutation = trpc.persona.declineGraduation.useMutation({
    onSuccess: () => {
      toast.success("继续陪伴");
      onClose();
    },
  });

  const paragraphs = useMemo(() => {
    const cleaned = letter.trim();
    if (!cleaned) return [];
    return cleaned.split(/\n{2,}|\r?\n/).filter(line => line.trim().length > 0);
  }, [letter]);

  return (
    <MotionModal
      open={open}
      onClose={onClose}
      ariaLabel="毕业时刻"
      className="max-w-lg max-h-[86vh] flex flex-col overflow-hidden rounded-3xl border-amber-500/25 dark:border-amber-400/20 bg-card/98 p-0 shadow-2xl"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-amber-500/[0.07] via-primary/[0.04] to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 inset-x-10 h-px bg-gradient-to-r from-transparent via-amber-500/45 to-transparent"
      />

      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300 shadow-2xs">
            <GraduationCap className="w-4.5 h-4.5" />
          </span>
          <div>
            <h3 className="font-semibold text-sm sm:text-base text-foreground tracking-tight">
              毕业时刻
            </h3>
            <p className="text-[11px] text-muted-foreground">
              一段温柔旅程的纪念与回响
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭毕业时刻弹窗"
          className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/75 hover:text-foreground transition-colors"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>

      <div className="panel-scrollbar relative z-10 flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <AnimatePresence mode="wait" initial={false}>
          {phase === "suggest" ? (
            <motion.div
              key="suggest"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={SPRING_SILKY}
              className="text-center space-y-5 py-2"
            >
              <div className="relative mx-auto flex h-18 w-18 items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-500/20 via-primary/15 to-transparent blur-md" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/12 to-primary/10 shadow-xs">
                  <Sunrise className="w-8 h-8 text-amber-700 dark:text-amber-300" />
                </div>
              </div>

              <div className="space-y-2.5 max-w-sm mx-auto">
                <p className="text-foreground font-semibold text-base leading-relaxed">
                  你和 {personaName} 已经完成一段故事旅程
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground leading-7">
                  也许是时候带着美好的回忆，温柔地说再见了。
                  {personaName} 会为你亲笔写下一封告别信，作为这段旅程的纪念。
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl h-10 border-border/80"
                  onClick={() => declineMutation.mutate({ id: personaId })}
                  disabled={declineMutation.isPending || graduateMutation.isPending}
                >
                  <Heart className="w-4 h-4 mr-1.5 text-primary" />
                  继续陪伴
                </Button>
                <Button
                  className="flex-1 rounded-xl h-10 shadow-xs"
                  onClick={() => graduateMutation.mutate({ id: personaId })}
                  disabled={graduateMutation.isPending || declineMutation.isPending}
                >
                  <Feather className="w-4 h-4 mr-1.5" />
                  {graduateMutation.isPending ? "正在写告别信..." : "开始毕业"}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="letter"
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -6 }}
              transition={SPRING_GENTLE}
              className="space-y-5"
            >
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span>来自 {personaName} 的告别信</span>
                <Sparkles className="w-3.5 h-3.5" />
              </div>

              <article
                className="relative overflow-hidden rounded-2xl border border-amber-500/30 dark:border-amber-400/25 bg-gradient-to-b from-amber-500/[0.06] via-card to-primary/[0.04] p-6 sm:p-7 shadow-inner"
                style={{
                  fontFamily:
                    "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif",
                }}
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-2 rounded-xl border border-amber-500/12 dark:border-amber-400/10"
                />

                <div className="relative space-y-4 text-foreground/92 text-[0.9375rem] leading-8">
                  {paragraphs.length > 0 ? (
                    paragraphs.map((para, index) => (
                      <motion.p
                        key={`${index}-${para.slice(0, 12)}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          ...SPRING_GENTLE,
                          delay: Math.min(0.06 + index * 0.07, 0.55),
                        }}
                        className="whitespace-pre-wrap break-words"
                      >
                        {para}
                      </motion.p>
                    ))
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{letter}</p>
                  )}

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: 0.4,
                      delay: Math.min(0.16 + paragraphs.length * 0.07, 0.65),
                    }}
                    className="pt-4 mt-4 border-t border-amber-500/20 text-right"
                  >
                    <p className="text-xs sm:text-sm text-muted-foreground tracking-wide">
                      —— {personaName}
                    </p>
                  </motion.div>
                </div>
              </article>

              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                告别信已妥善保存。你可以随时在分身大厅重温，也可以在想念时重新唤醒 {personaName}。
              </p>

              <Button className="w-full rounded-xl h-10 shadow-xs" onClick={onClose}>
                好的，再见
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionModal>
  );
}
