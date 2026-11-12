import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CollapseSection, EASE_OUT_EXPO, SPRING_SILKY } from "@/components/ui/motion";
import { useLocale } from "@/contexts/LocaleContext";
import { homeTranslations } from "@/components/home/home-copy";
import {
  Leaf, Globe, Brain, Smartphone, Heart, Shield,
  UserPlus, Upload, MessageCircle, Quote, ChevronDown,
  Sparkles, ArrowRight, BookOpen, ChevronUp,
  Layers, GraduationCap, Code2, Database, Zap, Server, Send,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE_OUT_EXPO },
  },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

/* ─── Nav ─── */

function LandingNav() {
  const [, navigate] = useLocation();
  const { locale, setLocale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 app-header">
      <div className="container app-nav">
        <div className="app-nav-brand">
          <div className="app-nav-mark">
            <Leaf className="w-4 h-4 text-primary" />
          </div>
          <span className="app-nav-title text-lg tracking-tight">书中人</span>
        </div>
        <div className="app-nav-spacer" />
        <div className="app-nav-actions flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="app-nav-back flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Globe className="w-4 h-4" />
            <span className="hidden sm:inline">{t.nav.language}</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/login")}
            className="app-nav-back text-sm rounded-xl"
          >
            {t.nav.login}
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/login")}
            className="hidden sm:inline-flex text-sm rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
          >
            {t.nav.register}
          </Button>
        </div>
      </div>
    </nav>
  );
}

/* ─── Editorial Conversation Preview ─── */

function ConversationPreview({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      variants={fadeUp}
      className="mt-12 sm:mt-14 max-w-2xl mx-auto text-left"
    >
      <div className="warm-card warm-card-static rounded-3xl border border-border/70 bg-card/88 backdrop-blur-xl shadow-xl overflow-hidden">
        {/* 预览窗顶栏 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 bg-muted/25">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-primary/12 border border-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
                灯
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">灯塔旅人</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/15 font-medium">
                  温柔 · 在线陪伴
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                熟悉你的语气习惯与共同回忆
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground bg-background/70 border border-border/60 px-2.5 py-1 rounded-full">
            <Sparkles className="w-3 h-3 text-primary" />
            <span>
              已铭记 <span className="font-mono tabular-nums text-foreground font-medium">12</span> 处细节
            </span>
          </div>
        </div>

        {/* 真实感细腻对话流 */}
        <div className="p-5 sm:p-6 space-y-4 bg-gradient-to-b from-transparent to-muted/15">
          <div className="flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed shadow-2xs">
              沿海的旧灯塔今晚亮了。我们去看看地图上那条小路吧。
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center text-primary text-xs font-semibold shrink-0 mt-0.5">
              灯
            </div>
            <div className="max-w-[85%] space-y-1.5">
              <div className="rounded-2xl rounded-tl-md bg-muted/55 dark:bg-muted/40 border border-border/65 px-4 py-3 text-sm text-foreground leading-relaxed">
                地图标注了潮水退去后的小路。我们先记下灯塔闪烁的节奏，再从码头走过去。
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/[0.07] border border-primary/15 text-[11px] text-muted-foreground">
                <Sparkles className="w-2.5 h-2.5 text-primary" />
                <span>唤醒共同记忆 · 灯塔地图与潮汐记录</span>
              </div>
            </div>
          </div>
        </div>

        {/* 底部轻交互输入栏预览 */}
        <div className="px-4 py-3 border-t border-border/60 bg-card/70 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onStart}
            className="flex-1 text-left text-xs text-muted-foreground/75 hover:text-foreground transition-colors px-3 py-2 rounded-xl bg-muted/35 border border-border/50 truncate"
          >
            把今天的日常慢慢说给 TA 听……
          </button>
          <button
            type="button"
            onClick={onStart}
            aria-label="开始对话体验"
            className="w-8 h-8 rounded-xl bg-primary/12 hover:bg-primary text-primary hover:text-primary-foreground flex items-center justify-center transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Hero ─── */

function HeroSection() {
  const [, navigate] = useLocation();
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <section className="relative min-h-[92svh] flex items-center justify-center overflow-hidden pt-28 pb-20">
      {/* 静奢柔和环境光层 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[44rem] h-[44rem] rounded-full bg-primary/[0.07] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/3 -left-24 w-80 h-80 rounded-full bg-primary/[0.04] blur-3xl"
      />
      <div className="landing-hero-glow" aria-hidden="true" />

      <motion.div
        className="relative z-10 text-center px-4 max-w-4xl mx-auto w-full"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.div variants={fadeUp} className="mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/[0.09] border border-primary/20 text-primary text-xs sm:text-sm font-medium tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            <span>温润有回应的数字记忆陪伴空间</span>
          </div>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-card/90 border border-border/70 shadow-sm backdrop-blur-md"
        >
          <Leaf className="w-8 h-8 text-primary" />
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="text-4xl sm:text-6xl lg:text-[4.25rem] font-bold text-foreground tracking-tight mb-5 leading-[1.14]"
        >
          {t.hero.tagline}
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-xl mx-auto mb-9 leading-relaxed"
        >
          {t.hero.subtitle}
        </motion.p>

        <motion.div
          variants={fadeUp}
          className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4"
        >
          <Button
            size="lg"
            onClick={() => navigate("/login")}
            className="w-full sm:w-auto rounded-xl px-8 h-12 text-base gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            {t.hero.cta}
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => document.getElementById("story")?.scrollIntoView({ behavior: "smooth" })}
            className="w-full sm:w-auto rounded-xl px-8 h-12 text-base gap-2 border-border/70 bg-card/65 hover:bg-muted/60 backdrop-blur-sm"
          >
            {t.hero.ctaSecondary}
            <ChevronDown className="w-4 h-4" />
          </Button>
        </motion.div>

        <ConversationPreview onStart={() => navigate("/login")} />
      </motion.div>
    </section>
  );
}

/* ─── Stats ─── */
function StatsSection() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];
  const stats = [
    { value: "10K+", label: t.stats.users },
    { value: "50K+", label: t.stats.personas },
    { value: "2M+", label: t.stats.messages },
    { value: "98%", label: t.stats.satisfaction },
  ];

  return (
    <section className="py-12 sm:py-16">
      <div className="container">
        <motion.div
          className="max-w-4xl mx-auto warm-card warm-card-static rounded-3xl border border-border/70 bg-card/75 backdrop-blur-md p-6 sm:p-8"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8">
            {stats.map((s, i) => (
              <motion.div key={i} variants={fadeUp} className="text-center">
                <div className="text-3xl sm:text-4xl font-semibold font-mono tabular-nums tracking-tight text-primary mb-1.5">
                  {s.value}
                </div>
                <div className="text-xs sm:text-sm text-muted-foreground">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Story ─── */
function StorySection() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];
  const [expanded, setExpanded] = useState(false);

  return (
    <section id="story" className="landing-section">
      <div className="container">
        <motion.div
          className="max-w-3xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.div variants={fadeUp} className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-13 h-13 rounded-2xl bg-primary/[0.08] border border-primary/15 mb-5">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4">
              {t.story.title}
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
              {t.story.subtitle}
            </p>
          </motion.div>

          <motion.div variants={fadeUp}>
            <blockquote className="warm-card warm-card-static rounded-3xl border border-border/70 p-6 sm:p-8 relative overflow-hidden">
              <Quote className="w-8 h-8 text-primary/15 absolute top-6 right-6" />
              <p className="text-lg sm:text-xl leading-relaxed text-foreground/90 italic relative z-10">
                “{t.story.quote}”
              </p>
            </blockquote>
          </motion.div>

          <CollapseSection open={expanded} id="landing-story-detail">
            <div className="space-y-6 pt-8 text-foreground/80 leading-relaxed px-1 sm:px-2">
              {t.story.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              <div className="h-px bg-border/60 my-8" />
              <p className="text-lg font-medium text-foreground text-center">
                {t.story.closing}
              </p>
              <p className="text-sm text-muted-foreground text-right">
                {t.story.signature}
              </p>
            </div>
          </CollapseSection>

          <motion.div variants={fadeUp} className="text-center mt-8">
            <Button
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="rounded-xl gap-2 text-primary hover:text-primary hover:bg-primary/8"
            >
              {expanded ? t.story.collapse : t.story.readMore}
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Features ─── */
const featureIcons = [Brain, Smartphone, Heart, Shield, Layers, GraduationCap];

function FeaturesSection() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <section id="features" className="landing-section bg-muted/25">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4">
            {t.features.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
            {t.features.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.features.items.map((item, i) => {
            const Icon = featureIcons[i] || Sparkles;
            return (
              <motion.div
                key={i}
                variants={fadeUp}
                transition={SPRING_SILKY}
                className="warm-card rounded-3xl border border-border/70 p-7 sm:p-8 group relative overflow-hidden"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-16 -right-16 w-36 h-36 rounded-full bg-primary/[0.08] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-2xl bg-primary/[0.08] border border-primary/15 flex items-center justify-center mb-5 group-hover:bg-primary/14 group-hover:border-primary/25 transition-colors">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground tracking-tight mb-2">
                    {item.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── How It Works ─── */

const stepIcons = [UserPlus, Upload, MessageCircle];

function HowItWorksSection() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <section id="how-it-works" className="landing-section">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4">
            {t.howItWorks.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
            {t.howItWorks.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="flex flex-col md:flex-row items-stretch justify-center gap-6 max-w-4xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.howItWorks.steps.map((step, i) => {
            const Icon = stepIcons[i] || Sparkles;
            return (
              <motion.div
                key={i}
                variants={fadeUp}
                className="flex-1 warm-card warm-card-static rounded-3xl border border-border/70 p-6 sm:p-7 text-center relative"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/[0.08] border border-primary/15 mb-5 relative">
                  <Icon className="w-7 h-7 text-primary" />
                  <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-mono tabular-nums font-semibold flex items-center justify-center shadow-2xs">
                    {i + 1}
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {step.desc}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Tech ─── */
const techIcons = [Code2, Code2, Server, Database, Database, Zap];

function TechSection() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <section id="tech" className="landing-section bg-muted/25">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4">
            {t.tech.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-base sm:text-lg max-w-lg mx-auto">
            {t.tech.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-3 sm:grid-cols-6 gap-3.5 max-w-3xl mx-auto mb-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.tech.stack.map((item, i) => {
            const Icon = techIcons[i] || Code2;
            return (
              <motion.div
                key={i}
                variants={fadeUp}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-card/85 border border-border/70 hover:border-primary/35 transition-colors"
              >
                <Icon className="w-5 h-5 text-primary" />
                <span className="text-xs sm:text-sm font-medium text-foreground text-center leading-tight">
                  {item.name}
                </span>
                <span className="text-[11px] text-muted-foreground text-center leading-tight">
                  {item.desc}
                </span>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.tech.highlights.map((item, i) => (
            <motion.div key={i} variants={fadeUp} className="warm-card rounded-3xl border border-border/70 p-6">
              <h3 className="text-base font-semibold text-foreground mb-2">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Testimonials ─── */
function TestimonialsSection() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <section id="testimonials" className="landing-section">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4">
            {t.testimonials.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
            {t.testimonials.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.testimonials.items.map((item, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="warm-card rounded-3xl border border-border/70 p-7 sm:p-8 relative flex flex-col justify-between"
            >
              <Quote className="w-7 h-7 text-primary/15 absolute top-6 right-6" />
              <p className="text-sm sm:text-base text-foreground/90 leading-relaxed mb-6 relative z-10">
                “{item.quote}”
              </p>
              <div className="flex items-center gap-3 pt-2 border-t border-border/50">
                <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-primary font-semibold text-sm">
                  {item.author[0]}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{item.author}</div>
                  <div className="text-xs text-muted-foreground">{item.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── CTA ─── */

function CTASection() {
  const [, navigate] = useLocation();
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <section className="landing-section">
      <div className="container">
        <motion.div
          className="max-w-3xl mx-auto warm-card warm-card-static rounded-3xl border border-border/70 bg-gradient-to-br from-card/95 via-card/85 to-primary/[0.06] p-8 sm:p-12 text-center relative overflow-hidden"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-1/4 w-64 h-64 rounded-full bg-primary/[0.08] blur-3xl"
          />
          <div className="relative z-10">
            <motion.div
              variants={fadeUp}
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/15 mb-6"
            >
              <Leaf className="w-7 h-7 text-primary" />
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight mb-4"
            >
              {t.hero.tagline}
            </motion.h2>
            <motion.p
              variants={fadeUp}
              className="text-muted-foreground text-base sm:text-lg mb-8 max-w-lg mx-auto"
            >
              {t.hero.subtitle}
            </motion.p>
            <motion.div variants={fadeUp}>
              <Button
                size="lg"
                onClick={() => navigate("/login")}
                className="rounded-xl px-10 h-12 text-base gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              >
                {t.hero.cta}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Footer ─── */

function LandingFooter() {
  const { locale } = useLocale();
  const t = homeTranslations[locale];

  return (
    <footer className="border-t border-border/70 bg-background">
      <div className="container py-12">
        <div className="flex flex-col md:flex-row justify-between gap-8">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
                <Leaf className="w-4 h-4 text-primary" />
              </div>
              <span className="text-base font-semibold text-foreground tracking-tight">书中人</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              {t.footer.tagline}
            </p>
          </div>

          <div className="flex gap-16">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">{t.footer.product}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">{t.footer.features}</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground transition-colors">{t.footer.pricing}</a></li>
                <li><a href="#tech" className="hover:text-foreground transition-colors">{t.footer.changelog}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">{t.footer.company}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#story" className="hover:text-foreground transition-colors">{t.footer.about}</a></li>
                <li><a href="#features" className="hover:text-foreground transition-colors">{t.footer.privacy}</a></li>
                <li><a href="#features" className="hover:text-foreground transition-colors">{t.footer.terms}</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border/60 text-center text-xs text-muted-foreground">
          &copy; <span className="font-mono tabular-nums">{new Date().getFullYear()}</span> {t.footer.copyright}
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ─── */

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <HeroSection />
      <StatsSection />
      <StorySection />
      <FeaturesSection />
      <HowItWorksSection />
      <TechSection />
      <TestimonialsSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}
