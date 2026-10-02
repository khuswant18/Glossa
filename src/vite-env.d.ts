declare module '*.css';
declare module '@fontsource-variable/inter';

declare module '*?url' {
  const src: string;
  export default src;
}
