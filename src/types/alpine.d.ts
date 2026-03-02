import "@kitajs/html";

declare module "@kitajs/html" {
  namespace JSX {
    interface HtmlTag {
      "x-data"?: string;
      "x-show"?: string;
      "x-bind"?: string;
      "x-on:click"?: string;
      "x-on:submit"?: string;
      "x-on:change"?: string;
      "x-on:input"?: string;
      "x-model"?: string;
      "x-text"?: string;
      "x-html"?: string;
      "x-ref"?: string;
      "x-if"?: string;
      "x-for"?: string;
      "x-transition"?: string;
      "x-effect"?: string;
      "x-init"?: string;
      "x-cloak"?: boolean | string;
      "@click"?: string;
      "@submit"?: string;
      "@change"?: string;
      "@input"?: string;
    }
  }
}
