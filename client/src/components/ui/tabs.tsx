import { SPRING_SNAPPY } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import * as React from "react";

const TabsMotionContext = React.createContext<{
  activeValue?: string;
  groupId: string;
} | null>(null);

function Tabs({
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState<string | undefined>(defaultValue);
  const groupId = React.useId();
  const activeValue = value !== undefined ? value : uncontrolledValue;

  const handleValueChange = React.useCallback(
    (next: string) => {
      if (value === undefined) {
        setUncontrolledValue(next);
      }
      onValueChange?.(next);
    },
    [value, onValueChange]
  );

  const ctx = React.useMemo(
    () => ({ activeValue, groupId }),
    [activeValue, groupId]
  );

  return (
    <TabsMotionContext.Provider value={ctx}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </TabsMotionContext.Provider>
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "bg-muted/70 text-muted-foreground relative inline-flex h-10 w-fit items-center justify-center rounded-xl border border-border/55 p-1 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  children,
  value,
  asChild,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ctx = React.useContext(TabsMotionContext);
  const isAnimated = Boolean(ctx && ctx.activeValue !== undefined && !asChild);
  const isActive = isAnimated && ctx?.activeValue === value;

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      asChild={asChild}
      className={cn(
        "focus-visible:border-ring focus-visible:ring-ring/45 focus-visible:outline-ring text-muted-foreground hover:text-foreground/85 data-[state=active]:text-foreground relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        !isAnimated &&
          "data-[state=active]:bg-card data-[state=active]:border-border/60 data-[state=active]:shadow-xs dark:data-[state=active]:bg-card/95",
        className
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {isActive && (
            <motion.span
              layoutId={`tabs-active-pill-${ctx!.groupId}`}
              transition={SPRING_SNAPPY}
              className="tabs-active-pill pointer-events-none absolute inset-0 rounded-[inherit] border border-border/60 bg-card shadow-xs dark:border-border/50 dark:bg-card/95"
            />
          )}
          <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
            {children}
          </span>
        </>
      )}
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none data-[state=active]:animate-fade-in", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
