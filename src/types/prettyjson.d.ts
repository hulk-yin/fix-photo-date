declare module 'prettyjson' {
    interface PrettyJsonOptions {
        noColor?: boolean;
        indent?: number;
        defaultIndentation?: number;
        inlineArrays?: boolean;
        emptyArrayMsg?: string;
        keysColor?: string;
        dashColor?: string;
        stringColor?: string;
        numberColor?: string;
    }

    function render(data: any, options?: PrettyJsonOptions, indent?: number): string;
    function renderString(data: string, options?: PrettyJsonOptions, indent?: number): string;

    export default {
        render,
        renderString
    };
} 