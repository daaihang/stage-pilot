import * as React from "react"
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"
import { RiArrowRightSLine, RiCheckLine } from "@remixicon/react"

function Menubar({ className, ...props }) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn("flex h-8 items-center gap-0.5 rounded-none border-0 bg-transparent p-0", className)}
      {...props}
    />
  )
}

function MenubarMenu({ ...props }) {
  return <MenuPrimitive.Root data-slot="menubar-menu" {...props} />
}

function MenubarTrigger({ className, ...props }) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "flex h-7 cursor-default items-center rounded-none px-2 text-xs font-medium outline-hidden select-none hover:bg-muted focus-visible:bg-muted data-popup-open:bg-muted data-popup-open:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({ className, ...props }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="isolate z-[70] outline-none" side="bottom" align="start" sideOffset={4}>
        <MenuPrimitive.Popup
          data-slot="menubar-content"
          className={cn(
            "z-[70] max-h-(--available-height) min-w-44 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-none bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenubarItem({ className, inset, variant = "default", ...props }) {
  return (
    <MenuPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/menubar-item relative flex cursor-default items-center gap-2 rounded-none px-2 py-2 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function MenubarSeparator({ className, ...props }) {
  return <MenuPrimitive.Separator data-slot="menubar-separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

function MenubarShortcut({ className, ...props }) {
  return <span data-slot="menubar-shortcut" className={cn("ml-auto text-xs tracking-widest text-muted-foreground group-focus/menubar-item:text-accent-foreground", className)} {...props} />
}

function MenubarSub({ ...props }) {
  return <MenuPrimitive.SubmenuRoot data-slot="menubar-sub" {...props} />
}

function MenubarSubTrigger({ className, children, ...props }) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menubar-sub-trigger"
      className={cn("flex cursor-default items-center gap-2 rounded-none px-2 py-2 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground", className)}
      {...props}
    >
      {children}
      <RiArrowRightSLine className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function MenubarSubContent({ className, ...props }) {
  return <MenubarContent data-slot="menubar-sub-content" className={cn("min-w-36", className)} side="right" align="start" sideOffset={0} {...props} />
}

function MenubarCheckboxItem({ className, children, ...props }) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn("relative flex cursor-default items-center gap-2 rounded-none py-2 pr-8 pl-2 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator><RiCheckLine /></MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function MenubarRadioGroup({ ...props }) {
  return <MenuPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
}

function MenubarRadioItem({ className, children, ...props }) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn("relative flex cursor-default items-center gap-2 rounded-none py-2 pr-8 pl-2 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50", className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <MenuPrimitive.RadioItemIndicator><RiCheckLine /></MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
}
