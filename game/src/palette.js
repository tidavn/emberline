// The look plan, in one place. Dock 9 is a night container yard: cold steel blues and
// concrete greys, one warm amber for Vanguard, one rust red for the Rustjackals, and a
// signal yellow for the bomb sites. The same names are the CSS custom properties in
// index.html, so the HUD and the 3D scene share one palette.
export const PALETTE = {
  canvas: '#10141a', // night sky / page background
  surface: '#252c36', // walls, floors, panels
  hairline: '#2e3540', // crates, trim, container ribs
  ink: '#e9e6df', // Vanguard whites, HUD text
  muted: '#8b98a5', // secondary text, distant steel
  accent: '#f0a830', // Vanguard amber: player team, money, highlights
  rust: '#d84a35', // Rustjackal red: enemy team, danger
  teal: '#3fb8a6', // site B marker, cool fill light
  site: '#ffd23f', // site A marker, bomb charge glow
  steel: '#4a5563', // containers, mid blue-grey
  deck: '#2e3742', // yard floor
};

export function shade(name) {
  return PALETTE[name];
}
