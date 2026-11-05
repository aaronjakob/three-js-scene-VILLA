// Spatial anchors and camera rig, in GLB/plan coordinates (+X east, +Y north, +Z up).
// Anchors are copied verbatim from SPATIAL_MANIFEST.json (V2 "single source of truth").
// Cameras: exterior ones start from the manifest; interior/roof ones follow the
// shot briefs (human eye level) because the manifest only has cutaway cameras.
// Every deviation from the manifest is listed in docs/RECONCILIATION.md.

export const ANCHORS = {
  living: [-6, -3, 18],
  workspace: [-11.7, 2.4, 18],
  dining: [6.55, -2.55, 18],
  kitchen: [8.7, 3.4, 18],
  skylight: [-4.1, -0.6, 28.9],
  pool: [0, -12, 18],
  waterfall: [-9.1, -12.6, 13.3],
  firepit: [13.25, -18.65, 12.65],
  entrance: [3, 13, 18],
};

const EYE = 18 + 1.62;

// fov = vertical field of view in degrees (16:9 reference frame)
export const VIEWS = [
  {
    id: 'aerial',
    ev: 0.0,
    key: '1',
    label: 'Seaward aerial',
    manifest: '01_Exterior_Aerial_Master (reframed: W vantage so pool, waterfall, firepit, sea + SE skyline share one frame)',
    position: [-58, -16, 40],
    target: [6, -12, 13],
    fov: 42,
  },
  {
    id: 'seaward',
    ev: 0.2,
    key: '2',
    label: 'Seaward facade',
    manifest: '02_Exterior_Seaward_Facade',
    position: [0, -58, 25],
    target: [0, -4, 21.5],
    fov: 36,
  },
  {
    id: 'entry',
    ev: 0.4,
    key: '3',
    label: 'North entry',
    manifest: '03_Exterior_Land_Entrance',
    position: [12, 40, 22.4],
    target: [2.2, 10, 20.8],
    fov: 46,
  },
  {
    id: 'west',
    ev: 0.15,
    key: '4',
    label: 'West waterfall',
    manifest: '04_Exterior_West_Waterfall',
    position: [-40, -26, 25],
    target: [-4, -10, 17],
    fov: 40,
  },
  {
    id: 'east',
    ev: 0.15,
    key: '5',
    label: 'East firepit',
    manifest: '05_Exterior_East_Firepit',
    position: [36, -27, 24],
    target: [5, -12, 16.5],
    fov: 40,
  },
  {
    id: 'lounge',
    key: '6',
    label: 'Lounge',
    manifest: '06_Cutaway_Living (eye-level per brief 06)',
    position: [0.6, 2.2, EYE],
    target: [-11, -6.5, 20.3],
    fov: 54,
    interior: true,
  },
  {
    id: 'workspace',
    key: '7',
    label: 'Workspace',
    manifest: '07_Cutaway_Workspace (eye-level per brief 07)',
    position: [-17.2, 4.0, EYE],
    target: [-8.0, -3.0, 19.0],
    fov: 58,
    interior: true,
  },
  {
    id: 'dining',
    key: '8',
    label: 'Kitchen and dining',
    manifest: '08_Cutaway_Dining_Kitchen (eye-level per brief 08; ref 07 framing: island left, table centre, glass and low sun behind)',
    position: [-0.5, 5.2, EYE],
    target: [12, -5, 19.0],
    fov: 58,
    interior: true,
  },
  {
    id: 'roof',
    ev: -0.25,
    key: '9',
    label: 'Roof opening',
    manifest: '09_Roof_Skylight_Closeup (NW vantage per brief 09)',
    position: [-27, 17, 37.5],
    target: [-1.5, -4.5, 27.2],
    fov: 40,
  },
  {
    id: 'hero-interior',
    ev: -0.15,
    key: '0',
    label: 'Living to sea',
    manifest: 'extra hero (threshold framing, ref 08: sofa left, glass line and pool right, low sun in frame)',
    position: [-14.0, -5.6, EYE],
    target: [9.2, -14.4, 18.9],
    fov: 58,
    interior: true,
  },
  {
    id: 'hero-exterior',
    ev: -0.25,
    key: '-',
    label: 'Terrace to sea',
    manifest: 'extra hero (west deck under the L1 canopy, refs 03 / terrace: house left, pool, sea and low sun right)',
    position: [-19.4, -6.9, 19.7],
    target: [11, -22.1, 17.3],
    fov: 58,
  },
];

export const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v]));
