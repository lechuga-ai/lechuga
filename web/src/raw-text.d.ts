// Vite's ?raw suffix imports a file's text as a string.
declare module "*.txt?raw" {
  const text: string;
  export default text;
}
