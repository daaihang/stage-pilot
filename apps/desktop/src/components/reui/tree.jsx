/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { createContext, useContext } from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"
import { RiSubtractLine, RiAddLine, RiArrowDownSLine } from "@remixicon/react"

const TreeContext = createContext({
  indent: 20,
  currentItem: undefined,
  tree: undefined,
  toggleIconType: "plus-minus",
})

function useTreeContext() {
  return useContext(TreeContext);
}

function Tree({
  indent = 20,
  tree,
  className,
  toggleIconType = "chevron",
  ...props
}) {
  const containerProps =
    tree && typeof tree.getContainerProps === "function"
      ? tree.getContainerProps()
      : {}
  // Keep the tree's generated keyboard/ARIA wiring while allowing callers to
  // provide the label and read-only state for a specific tree instance.
  const mergedProps = { ...containerProps, ...props }

  // Extract style from mergedProps to merge with our custom styles
  const { style: propStyle, ...otherProps } = mergedProps

  // Merge styles
  const mergedStyle = {
    ...propStyle,
    "--tree-indent": `${indent}px`
  }

  return (
    <TreeContext.Provider value={{ indent, tree, toggleIconType }}>
      <div
        data-slot="tree"
        style={mergedStyle}
        className={cn("flex flex-col", className)}
        {...otherProps}
      />
    </TreeContext.Provider>
  )
}

function TreeItem(
  {
    item,
    className,
    render,
    children,
    ...props
  }
) {
  const parentContext = useTreeContext()
  const { indent } = parentContext

  const itemProps = typeof item.getProps === "function" ? item.getProps() : {}
  const mergedProps = { ...props, children, ...itemProps }

  // Extract style from mergedProps to merge with our custom styles
  const { style: propStyle, ...otherProps } = mergedProps

  // Merge styles
  const mergedStyle = {
    ...propStyle,
    "--tree-padding": `${item.getItemMeta().level * indent}px`
  }

  const defaultProps = {
    "data-slot": "tree-item",
    style: mergedStyle,
    className: cn(
      "z-10 ps-(--tree-padding) outline-hidden select-none not-last:pb-0.5 focus:z-20 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    ),
    "data-focus":
      typeof item.isFocused === "function"
        ? item.isFocused() || false
        : undefined,
    "data-folder":
      typeof item.isFolder === "function"
        ? item.isFolder() || false
        : undefined,
    "data-selected":
      typeof item.isSelected === "function"
        ? item.isSelected() || false
        : undefined,
    "data-drag-target":
      typeof item.isDragTarget === "function"
        ? item.isDragTarget() || false
        : undefined,
    "data-search-match":
      typeof item.isMatchingSearch === "function"
        ? item.isMatchingSearch() || false
        : undefined,
    "aria-expanded": item.isFolder() ? item.isExpanded() : undefined,
  }

  return (
    <TreeContext.Provider value={{ ...parentContext, currentItem: item }}>
      {useRender({
        // Tree items can contain read-only controls such as permission
        // checkboxes. A div avoids nesting interactive elements while the
        // headless-tree props still provide treeitem semantics and focus.
        defaultTagName: "div",
        render,
        props: mergeProps(defaultProps, otherProps),
      })}
    </TreeContext.Provider>
  );
}

function TreeItemLabel(
  {
    item: propItem,
    children,
    className,
    ...props
  }
) {
  const { currentItem, toggleIconType } = useTreeContext()
  const item = propItem || currentItem

  if (!item) {
    console.warn("TreeItemLabel: No item provided via props or context")
    return null
  }

  return (
    <span
      data-slot="tree-item-label"
      className={cn(
        "in-focus-visible:ring-ring/50 bg-background hover:bg-accent in-data-[selected=true]:bg-accent in-data-[selected=true]:text-accent-foreground in-data-[drag-target=true]:bg-accent flex items-center gap-1 transition-colors not-in-data-[folder=true]:ps-7 in-focus-visible:ring-[3px] in-data-[search-match=true]:bg-blue-50! [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "rounded-none",
        "py-1.5",
        "px-2",
        "text-sm",
        className
      )}
      {...props}
    >
      {item.isFolder() &&
        (toggleIconType === "plus-minus" ? (
          item.isExpanded() ? (
            <RiSubtractLine className="text-muted-foreground size-3.5" stroke="currentColor" strokeWidth="1" />
          ) : (
            <RiAddLine className="text-muted-foreground size-3.5" stroke="currentColor" strokeWidth="1" />
          )
        ) : (
          <RiArrowDownSLine className="text-muted-foreground size-4 in-aria-[expanded=false]:-rotate-90" />
        ))}
      {children ||
        (typeof item.getItemName === "function" ? item.getItemName() : null)}
    </span>
  )
}

function TreeDragLine({
  className,
  ...props
}) {
  const { tree } = useTreeContext()

  if (!tree || typeof tree.getDragLineStyle !== "function") {
    console.warn(
      "TreeDragLine: No tree provided via context or tree does not have getDragLineStyle method"
    )
    return null
  }

  const dragLine = tree.getDragLineStyle()
  return (
    <div
      style={dragLine}
      className={cn(
        "bg-primary before:bg-background before:border-primary absolute z-30 -mt-px h-0.5 w-[unset] before:absolute before:-top-[3px] before:left-0 before:size-2 before:border-2",
        "before:rounded-full",
        className
      )}
      {...props}
    />
  )
}

export { Tree, TreeItem, TreeItemLabel, TreeDragLine }
