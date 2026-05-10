declare module '@joplin/fork-uslug' {
    interface Options {
        lower?: boolean;
        spaces?: boolean;
        allowedChars?: string;
    }
    export default function uslug(string: string, options?: Options): string;
}
