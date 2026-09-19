import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

/**
 * Owns the scroll boundary below the application titlebar.
 *
 * Document and workspace pages share the same centred content canvas. Workspace
 * pages additionally provide a full-height main-area scroll boundary so the
 * window detail host can keep the detail surface independently scrollable.
 */
const contentWidthClassName = {
  standard: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

const ContentWidthContext = createContext("standard");

export function ContentWidthContainer({ children, className }) {
  const contentWidth = useContext(ContentWidthContext);
  return <div className={cn("mx-auto min-w-0 w-full", contentWidthClassName[contentWidth] ?? contentWidthClassName.standard, className)}>{children}</div>;
}

export function AppContentLayout({ mode = "document", contentWidth = "standard", children, bottomBar, className }) {
  const scrollClassName = cn(
    "app-content-scroll min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4 md:p-6",
    mode === "workspace" && !bottomBar ? "h-full" : "flex-1",
  );

  return <ContentWidthContext.Provider value={contentWidth}>
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      <div className={scrollClassName}>
        <ContentWidthContainer className="min-h-full">{children}</ContentWidthContainer>
      </div>
      {bottomBar}
    </div>
  </ContentWidthContext.Provider>;
}
