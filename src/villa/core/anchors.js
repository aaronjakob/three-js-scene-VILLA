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
    key: '1',
    label: 'Seaward aerial',
    manifest: '01_Exterior_Aerial_Master',
    position: [40, -58, 46],
    target: [-1, -6, 19],
    fov: 38,
  },
  {
    id: 'seaward',
    key: '2',
    label: 'Seaward facade',
    manifest: '02_Exterior_Seaward_Facade',
    position: [0, -58, 25],
    target: [0, -4, 21.5],
    fov: 36,
  },
  {
    id: 'entry',
    key: '3',
    label: 'North entry',
    manifest: '03_Exterior_Land_Entrance',
    position: [5.5, 40, 22.4],
    target: [2.6, 9, 21.2],
    fov: 46,
  },
  {
    id: 'west',
    key: '4',
    label: 'West waterfall',
    manifest: '04_Exterior_West_Waterfall',
    position: [-40, -26, 25],
    target: [-4, -10, 17],
    fov: 40,
  },
  {
    id: 'east',
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
    target: [-11, -6.5, 19.15],
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
    manifest: '08_Cutaway_Dining_Kitchen (eye-level per brief 08)',
    position: [16.6, 1.4, EYE],
    target: [3.0, 0.0, 19.0],
    fov: 58,
    interior: true,
  },
  {
    id: 'roof',
    key: '9',
    label: 'Roof opening',
    manifest: '09_Roof_Skylight_Closeup (NW vantage per brief 09)',
    position: [-27, 17, 37.5],
    target: [-1.5, -4.5, 27.2],
    fov: 40,
  },
  {
    id: 'hero-interior',
    key: '0',
    label: 'Living to sea',
    manifest: 'extra hero',
    position: [-4.2, 3.0, EYE],
    target: [8.5, -14.5, 18.5],
    fov: 52,
    interior: true,
  },
  {
    id: 'hero-exterior',
    key: '-',
    label: 'Terrace to sea',
    manifest: 'extra hero',
    position: [-21, -9.5, 20.2],
    target: [12, -26, 14.5],
    fov: 50,
  },
];

export const VIEW_BY_ID = Object.fromEntries(VIEWS.map((v) => [v.id, v]));
