import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "inky-mascot": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        "data-state"?: string;
        "data-size"?: string;
      };
    }
  }
}

export {};
