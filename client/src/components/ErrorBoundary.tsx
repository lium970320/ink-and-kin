import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";
import { translate, type Locale } from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * The locale the provider persisted.
 *
 * The error boundary sits *above* the locale provider, so it cannot read the
 * locale from context — it reads the very same storage key the provider
 * writes.
 */
function currentLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  return (window.localStorage.getItem("mirrai-locale") as Locale) || "zh";
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const locale = currentLocale();

      return (
        <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4 sm:p-8">
          <div aria-hidden="true" className="gradient-mesh-bg" />
          <div className="warm-card warm-card-static relative w-full max-w-xl animate-fade-in rounded-3xl border border-border/70 p-6 sm:p-8">
            <h2 className="page-title mb-3">{translate(locale, "errors.boundaryTitle")}</h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              {translate(locale, "errors.boundaryBodyLong")}
            </p>

            <div className="panel-scrollbar mb-6 max-h-56 w-full overflow-auto rounded-2xl border border-border/70 bg-muted/40 p-4">
              <pre className="text-xs font-mono text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-6 h-10 rounded-md text-sm font-medium",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 transition-opacity cursor-pointer"
              )}
            >
              <RotateCcw size={15} />
              {translate(locale, "errors.reload")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
