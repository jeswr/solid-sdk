import { LitElement, type PropertyValues } from "lit";
import { type ResolvedTheme, type Theme } from "../theme-core.js";
export declare class JeswrThemeToggle extends LitElement {
    static properties: {
        theme: {
            type: StringConstructor;
            reflect: boolean;
        };
        resolvedTheme: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
    };
    /** The user's selected preference. Reflected to the `theme` attribute. */
    theme: Theme;
    /** The concrete mode applied right now. Reflected to `resolved-theme`. */
    resolvedTheme: ResolvedTheme;
    private mql;
    private readonly onSystemChange;
    static styles: import("lit").CSSResult[];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    /**
     * Set the preference, resolve + apply it to <html>, (un)subscribe to the OS
     * media query, and (when `persist`) save it. Emits `theme-change`.
     */
    private applyTheme;
    /** Subscribe to prefers-color-scheme only while in "system" mode. */
    private syncMediaListener;
    private teardownMediaListener;
    private onClick;
    render(): import("lit-html").TemplateResult<1>;
    protected willUpdate(changed: PropertyValues<this>): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-theme-toggle": JeswrThemeToggle;
    }
}
