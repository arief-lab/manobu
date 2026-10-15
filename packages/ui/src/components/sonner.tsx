"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/* Single-theme app (Noho paper): the toaster is pinned light. The old
 * next-themes useTheme() wiring died with the theme toggle — sonner
 * would otherwise follow the OS dark setting against our tokens. */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        error: <OctagonXIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        success: <CircleCheckIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
      }}
      style={
        {
          "--border-radius": "var(--radius)",
          "--error-background":
            "color-mix(in oklch, var(--destructive) 12%, var(--popover))",
          "--error-border":
            "color-mix(in oklch, var(--destructive) 35%, var(--border))",
          "--error-text": "var(--popover-foreground)",
          "--normal-bg": "var(--popover)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--popover-foreground)",
          /* richColors otherwise ships sonner's own green/red, which
           * reads off-palette on kibari paper: map them to the
           * 松/赤錆/山吹 tokens (tints of gofun, ink text). */
          "--success-background":
            "color-mix(in oklch, var(--success) 12%, var(--popover))",
          "--success-border":
            "color-mix(in oklch, var(--success) 35%, var(--border))",
          "--success-text": "var(--popover-foreground)",
          "--warning-background":
            "color-mix(in oklch, var(--warning) 12%, var(--popover))",
          "--warning-border":
            "color-mix(in oklch, var(--warning) 35%, var(--border))",
          "--warning-text": "var(--popover-foreground)",
        } as React.CSSProperties
      }
      theme="light"
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
