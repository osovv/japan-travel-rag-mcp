import "@kitajs/html";

declare module "@kitajs/html" {
  namespace JSX {
    interface HtmlTag {
      "hx-get"?: string;
      "hx-post"?: string;
      "hx-put"?: string;
      "hx-delete"?: string;
      "hx-patch"?: string;
      "hx-target"?: string;
      "hx-swap"?: string;
      "hx-trigger"?: string;
      "hx-indicator"?: string;
      "hx-push-url"?: string | boolean;
      "hx-select"?: string;
      "hx-vals"?: string;
      "hx-confirm"?: string;
      "hx-boost"?: string | boolean;
      "hx-ext"?: string;
      "hx-include"?: string;
      "hx-params"?: string;
      "hx-encoding"?: string;
      "hx-headers"?: string;
    }
  }
}
