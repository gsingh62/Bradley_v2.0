# Bradley_v2.0

A desktop Electron app where a cartoon mermaid moves along an Archimedean spiral on a real map, avoids (or swims through) water, and pauses for story events like picnics, chatting with a friend, and facing a sea witch.

## How It Works

- **Desktop shell**: Electron loads a single window (`main.js`) and renders the UI in `index.html`.
- **Map**: Leaflet displays OpenStreetMap tiles.
- **Water data**: The app queries the Overpass API for water polygons in the current map bounds, converts them to GeoJSON with `osmtogeojson`, and draws them as a layer.
- **Spiral motion**: The sprite follows an Archimedean spiral in screen space centered on the map, so it stays visually smooth during pans and zooms.
- **Water-aware sprite**: On land the character shows legs, and in water the sprite swaps to a tail.
- **Story events**: Every few seconds of travel, the character stops to trigger an event (picnic, chat, or monster encounter) with animated companion sprites.

## Controls

- **Spacing**: Adjusts the spiral spacing.
- **Speed**: Adjusts travel speed.
- **Draw Spiral**: Toggle the spiral overlay.
- **Allow Water**: When enabled, the character can move through water (tail sprite appears).
- **Refresh Water Polygons**: Fetches updated water data for the current viewport.

## Run Locally

```bash
npm install
npm start
```

## Notes

- Water data depends on Overpass API availability and rate limits.
- The app uses `@turf/turf` to detect if the sprite is inside water polygons.

