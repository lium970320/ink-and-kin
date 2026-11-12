import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group font-sans"
      toastOptions={{
        classNames: {
          toast:
            "group toast rounded-2xl border border-border/75 bg-popover/95 text-popover-foreground backdrop-blur-2xl shadow-xl px-4 py-3.5 text-xs sm:text-[13px]",
          description: "text-muted-foreground text-xs",
          actionButton:
            "rounded-xl bg-primary text-primary-foreground font-medium text-xs px-3 py-1.5",
          cancelButton:
            "rounded-xl bg-muted text-muted-foreground font-medium text-xs px-3 py-1.5",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "1rem",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
