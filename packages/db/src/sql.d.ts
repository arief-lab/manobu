/* TASK-44: bun's `with { type: "text" }` imports — the module type comes
 * from bun-types, which this package does not depend on (it only needs
 * libsql types). Ambient declaration keeps tsc happy without the dep. */
declare module "*.sql" {
  const content: string;
  export default content;
}
