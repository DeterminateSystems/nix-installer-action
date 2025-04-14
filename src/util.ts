export function truncateDerivation(drv: string) {
  return drv.replace(/^\/nix\/store\/[a-z0-9]+-/, "").replace(/\.drv$/, "");
}
